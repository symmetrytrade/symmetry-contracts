import hre, { deployments } from "hardhat";
import { expect } from "chai";
import { CONTRACTS, MAX_UINT256, UNIT, getTypedContract, normalized, usdcOf } from "../src/utils/utils";
import {
    getPythUpdateData,
    increaseNextBlockTimestamp,
    setPythAutoRefresh,
    setupPrices,
} from "../src/utils/test_utils";
import { ethers } from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { NetworkConfigs, getConfig } from "../src/config";

const chainlinkPrices: { [key: string]: number } = {
    Sequencer: 0,
    USDC: 0.98,
    WETH: 1500,
    WBTC: 20000,
};

const pythPrices: { [key: string]: number } = {
    USDC: 0.98,
    WETH: 1499,
    WBTC: 20000,
};

describe("Market", () => {
    let account1: ethers.Signer;
    let deployer: ethers.Signer;
    let config: NetworkConfigs;
    let market_: ethers.Contract;
    let perpTracker_: ethers.Contract;
    let priceOracle_: ethers.Contract;
    let positionManager_: ethers.Contract;
    let liquidityManager_: ethers.Contract;
    let marketSettings_: ethers.Contract;
    let marginTracker_: ethers.Contract;
    let WETH: string;
    let WBTC: string;
    let USDC_: ethers.Contract;

    before(async () => {
        deployer = (await hre.ethers.getSigners())[0];
        account1 = (await hre.ethers.getSigners())[1];
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH = await (await hre.ethers.getContract("WETH")).getAddress();
        WBTC = await (await hre.ethers.getContract("WBTC")).getAddress();
        USDC_ = await hre.ethers.getContract("USDC", deployer);
        market_ = await getTypedContract(hre, CONTRACTS.Market, account1);
        perpTracker_ = await getTypedContract(hre, CONTRACTS.PerpTracker, account1);
        priceOracle_ = await getTypedContract(hre, CONTRACTS.PriceOracle, account1);
        marketSettings_ = await getTypedContract(hre, CONTRACTS.MarketSettings);
        liquidityManager_ = await getTypedContract(hre, CONTRACTS.LiquidityManager, account1);
        positionManager_ = await getTypedContract(hre, CONTRACTS.PositionManager, account1);
        marginTracker_ = await getTypedContract(hre, CONTRACTS.MarginTracker, account1);
        config = getConfig(hre.network.name);

        await (await USDC_.transfer(await account1.getAddress(), usdcOf(100000000))).wait();

        // add liquidity
        USDC_ = USDC_.connect(account1);
        await (await USDC_.approve(await market_.getAddress(), MAX_UINT256)).wait();
        const amount = BigInt(usdcOf(1000000));
        const minLp = 980000n * UNIT;
        await (await liquidityManager_.addLiquidity(amount, minLp, await account1.getAddress(), false)).wait();

        await (
            await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("minKeeperFee")], [normalized(0)])
        ).wait();
    });

    it("getPrice", async () => {
        let price = await priceOracle_.getPrice(WETH);
        expect(price / UNIT).to.deep.eq(1499);

        await increaseNextBlockTimestamp(config.marketGeneralConfig.pythMaxAge);
        await helpers.mine();

        price = await priceOracle_.getPrice(WETH);
        expect(price / UNIT).to.deep.eq(1499);

        await setupPrices(hre, { WETH: 1500 }, {}, account1);
        price = await priceOracle_.getPrice(WETH);
        expect(price / UNIT).to.deep.eq(1500);

        await expect(priceOracle_.getOffchainPrice(WETH, 0)).to.be.revertedWith("PriceOracle: pyth price too stale");

        await setupPrices(hre, {}, { WETH: 1300 }, account1);
        await expect(priceOracle_.getPrice(WETH)).to.be.revertedWith("PriceOracle: oracle price divergence too large");

        await setupPrices(hre, {}, { WETH: 1600 }, account1);
        await expect(priceOracle_.getPrice(WETH)).to.be.revertedWith("PriceOracle: oracle price divergence too large");

        await setupPrices(hre, {}, { WETH: 1500 }, account1);

        // for convenience of following test, set divergence to 200%
        await (
            await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxPriceDivergence")], [normalized(2)])
        ).wait();
        await setPythAutoRefresh(hre);
    });

    it("tokenToUsd", async () => {
        let usdAmount = await market_.tokenToUsd(WETH, 2n * UNIT);
        expect(usdAmount / UNIT).to.deep.eq(3000);
        usdAmount = await market_.tokenToUsd(WETH, -5n * UNIT);
        expect(usdAmount / UNIT).to.deep.eq(-7500);
    });

    it("usdToToken", async () => {
        let tokenAmount = await market_.usdToToken(WETH, 3000n * UNIT);
        expect(tokenAmount / UNIT).to.deep.eq(2);
        tokenAmount = await market_.usdToToken(WETH, -7500n * UNIT);
        expect(tokenAmount / UNIT).to.deep.eq(-5);
    });

    it("trade ETH long", async () => {
        await (
            await positionManager_.depositMargin(await USDC_.getAddress(), usdcOf(1500), hre.ethers.ZeroHash)
        ).wait();
        let status = await market_.accountMarginStatus(await account1.getAddress());
        expect(status.currentMargin).to.deep.eq(normalized(1470));

        await (
            await positionManager_.submitOrder([
                WETH,
                normalized(10),
                normalized(1550),
                usdcOf(0),
                (await helpers.time.latest()) + 100,
                false,
            ])
        ).wait();
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
                await account1.getAddress(),
                WETH,
                normalized(10),
                "1507245535714285712845", // avg price
                "15057397959183673455", // trading fee
                "0",
                orderId
            );
        const userCollaterals = await marginTracker_.userCollaterals(
            await account1.getAddress(),
            await USDC_.getAddress()
        );
        expect(userCollaterals).to.deep.eq(usdcOf(1500));
        const position = await perpTracker_.getPosition(await account1.getAddress(), WETH);
        expect(position.accFunding).to.deep.eq(0);
        expect(position.avgPrice).to.deep.eq("1507245535714285712845");
        status = await market_.accountMarginStatus(await account1.getAddress());
        expect(status.currentMargin).to.deep.eq("1397544642857142871550");
        expect(status.positionNotional).to.deep.eq("15000000000000000000000");
        const lpPosition = await perpTracker_.getLpPosition(WETH);
        expect(lpPosition.longSize).to.deep.eq(0);
        expect(lpPosition.shortSize).to.deep.eq("-10000000000000000000");
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq("980072455357142857128450");
        expect(globalStatus.netOpenInterest).to.deep.eq("15000000000000000000000");
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
            positionManager_.submitOrder([
                WBTC,
                normalized(-2),
                normalized(15000),
                usdcOf(0),
                (await helpers.time.latest()) + 100,
                false,
            ])
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
        await (
            await positionManager_.submitOrder([
                WBTC,
                normalized(-0.5),
                normalized(15000),
                usdcOf(0),
                (await helpers.time.latest()) + 100,
                false,
            ])
        ).wait();
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
                await account1.getAddress(),
                WBTC,
                normalized(-0.5),
                "19929034394156457628380", // avg price
                "9974491688766995810", // trading fee
                "0",
                orderId
            );
        const userCollaterals = await marginTracker_.userCollaterals(
            await account1.getAddress(),
            await USDC_.getAddress()
        );
        expect(userCollaterals).to.deep.eq(usdcOf(1500));
        const position = await perpTracker_.getPosition(await account1.getAddress(), WBTC);
        expect(position.accFunding).to.deep.eq(0);
        expect(position.avgPrice).to.deep.eq("19929034394156457628380");
        // funding of ETH position
        // since the long ETH trade, there should be 5+5+60+100+10+60=240s passed
        const fs = await perpTracker_.nextAccFunding(WETH, normalized(1500));
        expect(fs[0]).to.deep.eq("12754159074335926"); // next funding rate
        expect(fs[1]).to.deep.eq("26571164738199000"); // acc funding
        // margin status
        const status = await market_.accountMarginStatus(await account1.getAddress());
        expect(status.currentMargin).to.deep.eq("1361796128287989695740");
        expect(status.positionNotional).to.deep.eq("25000000000000000000000");
        const lpPosition = await perpTracker_.getLpPosition(WBTC);
        expect(lpPosition.longSize).to.deep.eq(normalized(0.5));
        expect(lpPosition.shortSize).to.deep.eq(0);
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq("980108203871712010304260");
        expect(globalStatus.netOpenInterest).to.deep.eq("25000000000000000000000");
    });

    it("close BTC short", async () => {
        await increaseNextBlockTimestamp(10); // 10s
        await (
            await positionManager_.submitOrder([
                WBTC,
                normalized(0.5),
                normalized(25000),
                usdcOf(0),
                (await helpers.time.latest()) + 100,
                true,
            ])
        ).wait();
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
                await account1.getAddress(),
                WBTC,
                normalized(0.5),
                "14986202042334606478395", // avg price
                "7485615405761541697", // trading fee
                "0",
                orderId
            );
        // funding of BTC position
        // since the short BTC trade, there should be 10 + 60 = 70s passed
        const fs = await perpTracker_.nextAccFunding(WBTC, normalized(15000));
        expect(fs[0]).to.deep.eq("-2479884920822164"); // next funding rate
        expect(fs[1]).to.deep.eq("-15068745178605000"); // acc funding
        const userCollaterals = await marginTracker_.userCollaterals(
            await account1.getAddress(),
            await USDC_.getAddress()
        );
        expect(userCollaterals).to.deep.eq("3971408641");
        const position = await perpTracker_.getPosition(await account1.getAddress(), WBTC);
        expect(position.accFunding).to.deep.eq("0");
        expect(position.avgPrice).to.deep.eq("0");
        // margin status
        const status = await market_.accountMarginStatus(await account1.getAddress());
        expect(status.currentMargin).to.deep.eq("3819081796986562836550");
        expect(status.positionNotional).to.deep.eq(normalized(15000));
        const lpPosition = await perpTracker_.getLpPosition(WBTC);
        expect(lpPosition.longSize).to.deep.eq(0);
        expect(lpPosition.shortSize).to.deep.eq(0);
        expect(lpPosition.avgPrice).to.deep.eq("14986202042334606478395");
        expect(lpPosition.accFunding).to.deep.eq("-15068745178605000");
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq("977650918203013437163450");
        expect(globalStatus.netOpenInterest).to.deep.eq("15000000000000000000000");
    });
});
