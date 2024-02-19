import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { encodeBytes32String, Signer, ZeroHash } from "ethers";
import hre, { deployments } from "hardhat";
import { getConfig, NetworkConfigs } from "../src/config";
import {
    getPythUpdateData,
    increaseNextBlockTimestamp,
    setPythAutoRefresh,
    setupPrices,
} from "../src/utils/test_utils";
import { CONTRACTS, getTypedContract, MAX_UINT256, normalized, UNIT, usdcOf } from "../src/utils/utils";
import {
    FaucetToken,
    LiquidityManager,
    MarginTracker,
    Market,
    MarketSettings,
    PerpTracker,
    PositionManager,
    PriceOracle,
} from "../typechain-types";

const chainlinkPrices: { [key: string]: string | number } = {
    Sequencer: 0,
    USDC: "0.98",
    WETH: 1500,
    WBTC: 20000,
};

const pythPrices: { [key: string]: string | number } = {
    USDC: "0.98",
    WETH: 1499,
    WBTC: 20000,
};

describe("Market", () => {
    let account1: Signer;
    let config: NetworkConfigs;
    let market_: Market;
    let perpTracker_: PerpTracker;
    let priceOracle_: PriceOracle;
    let positionManager_: PositionManager;
    let liquidityManager_: LiquidityManager;
    let marketSettings_: MarketSettings;
    let marginTracker_: MarginTracker;
    let WETH_: FaucetToken;
    let WBTC_: FaucetToken;
    let USDC_: FaucetToken;

    before(async () => {
        account1 = (await hre.ethers.getSigners())[1];
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH_ = await getTypedContract(hre, CONTRACTS.WETH);
        WBTC_ = await getTypedContract(hre, CONTRACTS.WBTC);
        USDC_ = await getTypedContract(hre, CONTRACTS.USDC);
        market_ = await getTypedContract(hre, CONTRACTS.Market, account1);
        perpTracker_ = await getTypedContract(hre, CONTRACTS.PerpTracker, account1);
        priceOracle_ = await getTypedContract(hre, CONTRACTS.PriceOracle, account1);
        marketSettings_ = await getTypedContract(hre, CONTRACTS.MarketSettings);
        liquidityManager_ = await getTypedContract(hre, CONTRACTS.LiquidityManager, account1);
        positionManager_ = await getTypedContract(hre, CONTRACTS.PositionManager, account1);
        marginTracker_ = await getTypedContract(hre, CONTRACTS.MarginTracker, account1);
        config = getConfig(hre.network.name);

        await USDC_.transfer(account1, usdcOf(100000000));

        // add liquidity
        USDC_ = USDC_.connect(account1);
        await USDC_.approve(market_, MAX_UINT256);
        const amount = usdcOf(1000000);
        const minLp = 980000n * UNIT;
        await liquidityManager_.addLiquidity(amount, minLp, account1, false);

        await marketSettings_.setIntVals([encodeBytes32String("minKeeperFee")], [normalized(0)]);
    });

    it("getPrice", async () => {
        let price = await priceOracle_.getPrice(WETH_);
        expect(price / UNIT).to.eq(1499);

        await increaseNextBlockTimestamp(config.marketGeneralConfig.pythMaxAge);
        await helpers.mine();

        price = await priceOracle_.getPrice(WETH_);
        expect(price / UNIT).to.eq(1499);

        await setupPrices(hre, { WETH: 1500 }, {}, account1);
        price = await priceOracle_.getPrice(WETH_);
        expect(price / UNIT).to.eq(1500);

        await expect(priceOracle_.getOffchainPrice(WETH_, 0)).to.be.revertedWith("PriceOracle: pyth price too stale");

        await setupPrices(hre, {}, { WETH: 1300 }, account1);
        await expect(priceOracle_.getPrice(WETH_)).to.be.revertedWith("PriceOracle: oracle price divergence too large");

        await setupPrices(hre, {}, { WETH: 1600 }, account1);
        await expect(priceOracle_.getPrice(WETH_)).to.be.revertedWith("PriceOracle: oracle price divergence too large");

        await setupPrices(hre, {}, { WETH: 1500 }, account1);

        // for convenience of following test, set divergence to 200%
        await marketSettings_.setIntVals([encodeBytes32String("maxPriceDivergence")], [normalized(2)]);
        await setPythAutoRefresh(hre);
    });

    it("tokenToUsd", async () => {
        let usdAmount = await market_.tokenToUsd(WETH_, 2n * UNIT);
        expect(usdAmount / UNIT).to.eq(3000);
        usdAmount = await market_.tokenToUsd(WETH_, -5n * UNIT);
        expect(usdAmount / UNIT).to.eq(-7500);
    });

    it("usdToToken", async () => {
        let tokenAmount = await market_.usdToToken(WETH_, 3000n * UNIT);
        expect(tokenAmount / UNIT).to.eq(2);
        tokenAmount = await market_.usdToToken(WETH_, -7500n * UNIT);
        expect(tokenAmount / UNIT).to.eq(-5);
    });

    it("trade ETH long", async () => {
        await positionManager_.depositMargin(USDC_, usdcOf(1500), ZeroHash);
        let status = await market_.accountMarginStatus(account1);
        expect(status.currentMargin).to.eq(normalized(1470));

        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(10),
            acceptablePrice: normalized(1550),
            keeperFee: usdcOf(0),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        const pythUpdateData = await getPythUpdateData(hre, { WETH: 1500 });
        await expect(
            positionManager_.executeOrder(orderId, pythUpdateData.updateData, {
                value: pythUpdateData.fee,
            })
        )
            .to.emit(market_, "Traded")
            .withArgs(
                account1,
                WETH_,
                normalized(10),
                "1507245535714285712845", // avg price
                "15057397959183673455", // trading fee
                "0",
                orderId
            );
        const userCollaterals = await marginTracker_.userCollaterals(account1, USDC_);
        expect(userCollaterals).to.eq(usdcOf(1500));
        const position = await perpTracker_.getPosition(account1, WETH_);
        expect(position.accFunding).to.eq(0);
        expect(position.avgPrice).to.eq("1507245535714285712845");
        status = await market_.accountMarginStatus(account1);
        expect(status.currentMargin).to.eq("1397544642857142871550");
        expect(status.positionNotional).to.eq("15000000000000000000000");
        const lpPosition = await perpTracker_.getLpPosition(WETH_);
        expect(lpPosition.longSize).to.eq(0);
        expect(lpPosition.shortSize).to.eq("-10000000000000000000");
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.eq("980072455357142857128450");
        expect(globalStatus.netOpenInterest).to.eq("15000000000000000000000");
        await increaseNextBlockTimestamp(5); // 5s
        await expect(
            positionManager_.executeOrder(orderId, pythUpdateData.updateData, {
                value: pythUpdateData.fee,
            })
        ).to.be.revertedWith("PositionManager: not pending");
    });
    it("trade BTC short revert", async () => {
        await increaseNextBlockTimestamp(5); // 5s
        await expect(
            positionManager_.submitOrder({
                token: WBTC_,
                size: normalized(-2),
                acceptablePrice: normalized(15000),
                keeperFee: usdcOf(0),
                expiry: (await helpers.time.latest()) + 100,
                reduceOnly: false,
            })
        ).to.be.revertedWith("PositionManager: leverage ratio too large");
        const orderId = await positionManager_.orderCnt();

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        const pythUpdateData = await getPythUpdateData(hre, { WBTC: 20000 });
        await expect(
            positionManager_.executeOrder(orderId, pythUpdateData.updateData, {
                value: pythUpdateData.fee,
            })
        ).to.be.revertedWith("PositionManger: invalid order id");
        await increaseNextBlockTimestamp(100); // 100s
        await expect(
            positionManager_.executeOrder(orderId, pythUpdateData.updateData, {
                value: pythUpdateData.fee,
            })
        ).to.be.revertedWith("PositionManger: invalid order id");
    });
    it("trade BTC short", async () => {
        await increaseNextBlockTimestamp(10); // 10s
        await positionManager_.submitOrder({
            token: WBTC_,
            size: normalized("-0.5"),
            acceptablePrice: normalized(15000),
            keeperFee: usdcOf(0),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        const pythUpdateData = await getPythUpdateData(hre, { WBTC: 20000 });
        await expect(
            positionManager_.executeOrder(orderId, pythUpdateData.updateData, {
                value: pythUpdateData.fee,
            })
        )
            .to.emit(market_, "Traded")
            .withArgs(
                account1,
                WBTC_,
                normalized("-0.5"),
                "19929034394156457628380", // avg price
                "9974491688766995810", // trading fee
                "0",
                orderId
            );
        const userCollaterals = await marginTracker_.userCollaterals(account1, USDC_);
        expect(userCollaterals).to.eq(usdcOf(1500));
        const position = await perpTracker_.getPosition(account1, WBTC_);
        expect(position.accFunding).to.eq(0);
        expect(position.avgPrice).to.eq("19929034394156457628380");
        // funding of ETH position
        // since the long ETH trade, there should be 5+5+60+100+10+60=240s passed
        const fs = await perpTracker_.nextAccFunding(WETH_, normalized(1500));
        expect(fs[0]).to.eq("12754159074335926"); // next funding rate
        expect(fs[1]).to.eq("26571164738199000"); // acc funding
        // margin status
        const status = await market_.accountMarginStatus(account1);
        expect(status.currentMargin).to.eq("1361796128287989695740");
        expect(status.positionNotional).to.eq("25000000000000000000000");
        const lpPosition = await perpTracker_.getLpPosition(WBTC_);
        expect(lpPosition.longSize).to.eq(normalized("0.5"));
        expect(lpPosition.shortSize).to.eq(0);
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.eq("980108203871712010304260");
        expect(globalStatus.netOpenInterest).to.eq("25000000000000000000000");
    });

    it("close BTC short", async () => {
        await increaseNextBlockTimestamp(10); // 10s
        await positionManager_.submitOrder({
            token: WBTC_,
            size: normalized("0.5"),
            acceptablePrice: normalized(25000),
            keeperFee: usdcOf(0),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: true,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        const pythUpdateData = await getPythUpdateData(hre, { WBTC: 15000 });
        await expect(
            positionManager_.executeOrder(orderId, pythUpdateData.updateData, {
                value: pythUpdateData.fee,
            })
        )
            .to.emit(market_, "Traded")
            .withArgs(
                account1,
                WBTC_,
                normalized("0.5"),
                "14986202042334606478395", // avg price
                "7485615405761541697", // trading fee
                "0",
                orderId
            );
        // funding of BTC position
        // since the short BTC trade, there should be 10 + 60 = 70s passed
        const fs = await perpTracker_.nextAccFunding(WBTC_, normalized(15000));
        expect(fs[0]).to.eq("-2479884920822164"); // next funding rate
        expect(fs[1]).to.eq("-15068745178605000"); // acc funding
        const userCollaterals = await marginTracker_.userCollaterals(account1, USDC_);
        expect(userCollaterals).to.eq("3971408641");
        const position = await perpTracker_.getPosition(account1, WBTC_);
        expect(position.accFunding).to.eq("0");
        expect(position.avgPrice).to.eq("0");
        // margin status
        const status = await market_.accountMarginStatus(account1);
        expect(status.currentMargin).to.eq("3819081796986562836550");
        expect(status.positionNotional).to.eq(normalized(15000));
        const lpPosition = await perpTracker_.getLpPosition(WBTC_);
        expect(lpPosition.longSize).to.eq(0);
        expect(lpPosition.shortSize).to.eq(0);
        expect(lpPosition.avgPrice).to.eq("14986202042334606478395");
        expect(lpPosition.accFunding).to.eq("-15068745178605000");
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.eq("977650918203013437163450");
        expect(globalStatus.netOpenInterest).to.eq("15000000000000000000000");
    });
});
