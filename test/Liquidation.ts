import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { encodeBytes32String, MaxUint256, Signer, ZeroHash } from "ethers";
import hre, { deployments } from "hardhat";
import { getConfig, NetworkConfigs } from "../src/config";
import {
    getPythUpdateData,
    increaseNextBlockTimestamp,
    setPythAutoRefresh,
    setupPrices,
} from "../src/utils/test_utils";
import { CONTRACTS, getTypedContract, normalized, usdcOf } from "../src/utils/utils";
import {
    FaucetToken,
    LiquidityManager,
    MarginTracker,
    Market,
    MarketSettings,
    PositionManager,
    PriceOracle,
} from "../typechain-types";

const chainlinkPrices: { [key: string]: number } = {
    Sequencer: 0,
    USDC: 1,
    WETH: 1000,
    WBTC: 10000,
};

const pythPrices: { [key: string]: number } = {
    USDC: 1,
    WETH: 1000,
    WBTC: 10000,
};

describe("Liquidation", () => {
    let account1: Signer;
    let account2: Signer;
    let account3: Signer;
    let account4: Signer;
    let liquidator: Signer;
    let config: NetworkConfigs;
    let market_: Market;
    let priceOracle_: PriceOracle;
    let positionManager_: PositionManager;
    let liquidityManager_: LiquidityManager;
    let marketSettings_: MarketSettings;
    let marginTracker_: MarginTracker;
    let WETH_: FaucetToken;
    let WBTC_: FaucetToken;
    let USDC_: FaucetToken;

    before(async () => {
        [, account1, account2, account3, account4, liquidator] = await hre.ethers.getSigners();
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH_ = await getTypedContract(hre, CONTRACTS.WETH);
        WBTC_ = await getTypedContract(hre, CONTRACTS.WBTC);
        USDC_ = await getTypedContract(hre, CONTRACTS.USDC);
        market_ = await getTypedContract(hre, CONTRACTS.Market, account1);
        priceOracle_ = await getTypedContract(hre, CONTRACTS.PriceOracle, account1);
        marketSettings_ = await getTypedContract(hre, CONTRACTS.MarketSettings);
        liquidityManager_ = await getTypedContract(hre, CONTRACTS.LiquidityManager, account1);
        positionManager_ = await getTypedContract(hre, CONTRACTS.PositionManager, account1);
        marginTracker_ = await getTypedContract(hre, CONTRACTS.MarginTracker, account1);
        config = getConfig(hre.network.name);

        for (let i = 1; i <= 4; ++i) {
            await USDC_.transfer((await hre.ethers.getSigners())[i], usdcOf(100000000));
            await USDC_.connect((await hre.ethers.getSigners())[i]).approve(market_, MaxUint256);
        }

        // add liquidity
        USDC_ = USDC_.connect(account1);
        const amount = usdcOf(1000000); // 1M
        const minLp = normalized(100000);
        await liquidityManager_.addLiquidity(amount, minLp, account1, false);

        // set fee and slippage to zero for convenience
        await marketSettings_.setIntVals([encodeBytes32String("maxFundingVelocity")], [0]);
        await marketSettings_.setIntVals([encodeBytes32String("maxFinancingFeeRate")], [0]);
        await marketSettings_.setIntVals([encodeBytes32String("liquidityRange")], [0]);
        await marketSettings_.setIntVals([encodeBytes32String("perpMakerFee")], [0]);
        await marketSettings_.setIntVals([encodeBytes32String("perpTakerFee")], [0]);
        await marketSettings_.setIntVals([encodeBytes32String("pythMaxAge")], [1000000]);
        await marketSettings_.setIntVals([encodeBytes32String("minKeeperFee")], [normalized(0)]);
        // set debt interest rate to 0%
        await marketSettings_.setIntVals([encodeBytes32String("minInterestRate")], [0]);
        await marketSettings_.setIntVals([encodeBytes32String("maxInterestRate")], [0]);
        await marketSettings_.setIntVals([encodeBytes32String("vertexInterestRate")], [0]);
        await marketSettings_.setIntVals([encodeBytes32String("maxPriceDivergence")], [normalized(1000)]);
        await setPythAutoRefresh(hre);
    });

    it("liquidate and pay fee & penalty", async () => {
        // deposit margins
        await positionManager_.depositMargin(USDC_, usdcOf(1000), ZeroHash);

        // open eth long, 10000 notional
        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(10),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(0),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        let orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await positionManager_.executeOrder(orderId, []);

        // open btc long, 100 notional
        await positionManager_.submitOrder({
            token: WBTC_,
            size: normalized("0.01"),
            acceptablePrice: normalized(10000),
            keeperFee: usdcOf(0),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await positionManager_.executeOrder(orderId, []);

        const pythUpdateData = await getPythUpdateData(hre, { WETH: 918 });
        await priceOracle_.updatePythPrice(pythUpdateData.updateData, {
            value: pythUpdateData.fee,
        });

        // liquidate
        await expect(positionManager_.connect(liquidator).liquidatePosition(account1, WETH_, []))
            .to.emit(positionManager_, "Liquidated")
            .withArgs(account1, WETH_, normalized(10), normalized(9180), normalized("32.13"), normalized("91.8"), 0)
            .to.emit(positionManager_, "LiquidationFee")
            .withArgs(account1, normalized(9180), normalized("32.13"), usdcOf("32.13"))
            .to.emit(positionManager_, "LiquidationPenalty")
            .withArgs(account1, normalized(9180), normalized("91.8"), usdcOf("91.8"));
        const status = await market_.accountMarginStatus(account1);
        expect(status.currentMargin).to.eq(normalized("56.07"));
        const userCollaterals = await marginTracker_.userCollaterals(account1, USDC_);
        expect(userCollaterals).to.eq(usdcOf("56.07"));
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.eq(normalized(1000000 + 820));
        expect(globalStatus.netOpenInterest).to.eq(normalized(100));
        const insurance = await market_.insuranceBalance();
        expect(insurance).to.eq(usdcOf("91.8"));
        const liquidatorBalance = await marginTracker_.userCollaterals(liquidator, USDC_);
        expect(liquidatorBalance).to.eq(usdcOf("32.13"));
        expect(await positionManager_.isLiquidatable(account1)).to.eq(false);
    });
    it("liquidate and pay fee, insufficient to pay all penalty", async () => {
        positionManager_ = positionManager_.connect(account2);
        // deposit margins
        await positionManager_.depositMargin(USDC_, usdcOf(1000), ZeroHash);

        let pythUpdateData = await getPythUpdateData(hre, { WETH: 1000 });
        // open eth long, 10000 notional
        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(10),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(0),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await positionManager_.executeOrder(orderId, pythUpdateData.updateData, { value: pythUpdateData.fee });

        pythUpdateData = await getPythUpdateData(hre, { WETH: 910 });
        await priceOracle_.updatePythPrice(pythUpdateData.updateData, {
            value: pythUpdateData.fee,
        });

        // liquidate
        await expect(positionManager_.connect(liquidator).liquidatePosition(account2, WETH_, []))
            .to.emit(positionManager_, "Liquidated")
            .withArgs(account2, WETH_, normalized(10), normalized(9100), normalized("31.85"), normalized(91), 0)
            .to.emit(positionManager_, "LiquidationFee")
            .withArgs(account2, normalized(9100), normalized("31.85"), usdcOf("31.85"))
            .to.emit(positionManager_, "LiquidationPenalty")
            .withArgs(account2, normalized(9100), normalized(91), usdcOf(91))
            .to.emit(marginTracker_, "DeficitLoss")
            .withArgs(account2, usdcOf("22.85"), usdcOf("22.85"), 0);
        const status = await market_.accountMarginStatus(account2);
        expect(status.currentMargin).to.eq(0);
        const userCollaterals = await marginTracker_.userCollaterals(account2, USDC_);
        expect(userCollaterals).to.eq(0);
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.eq(
            normalized(1001720) // 1000000 + 820 + 900
        );
        expect(globalStatus.netOpenInterest).to.eq(normalized(100));
        const insurance = await market_.insuranceBalance();
        expect(insurance).to.eq(usdcOf("159.95")); // 91.8 + 91 - 22.85
        const liquidatorBalance = await marginTracker_.userCollaterals(liquidator, USDC_);
        expect(liquidatorBalance).to.eq(usdcOf("63.98")); // 32.13 + 31.85
        expect(await positionManager_.isLiquidatable(account2)).to.eq(false);
    });
    it("liquidate but insufficient to pay fee and penalty", async () => {
        positionManager_ = positionManager_.connect(account3);
        // deposit margins
        await positionManager_.depositMargin(USDC_, usdcOf(1000), ZeroHash);

        let pythUpdateData = await getPythUpdateData(hre, { WETH: 1000 });
        // open eth long, 10000 notional
        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(10),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(0),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await positionManager_.executeOrder(orderId, pythUpdateData.updateData, { value: pythUpdateData.fee });

        pythUpdateData = await getPythUpdateData(hre, { WETH: 901 });
        await priceOracle_.updatePythPrice(pythUpdateData.updateData, {
            value: pythUpdateData.fee,
        });

        // liquidate
        await expect(positionManager_.connect(liquidator).liquidatePosition(account3, WETH_, []))
            .to.emit(positionManager_, "Liquidated")
            .withArgs(account3, WETH_, normalized(10), normalized(9010), normalized("31.535"), normalized("90.1"), 0)
            .to.emit(positionManager_, "LiquidationFee")
            .withArgs(account3, normalized(9010), normalized("31.535"), usdcOf("31.535"))
            .to.emit(positionManager_, "LiquidationPenalty")
            .withArgs(account3, normalized(9010), normalized("90.1"), usdcOf("90.1"))
            .to.emit(marginTracker_, "DeficitLoss")
            .withArgs(account3, usdcOf("111.635"), usdcOf("111.635"), 0);
        const status = await market_.accountMarginStatus(account3);
        expect(status.currentMargin).to.eq(0);
        const userCollaterals = await marginTracker_.userCollaterals(account3, USDC_);
        expect(userCollaterals).to.eq(0);
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.eq(
            normalized(1002710) // 1000000 + 820 + 900 + 990
        );
        expect(globalStatus.netOpenInterest).to.eq(normalized(100));
        const insurance = await market_.insuranceBalance();
        expect(insurance).to.eq(usdcOf("138.415")); // 91.8 + 91 - 22.85 + 90.1 - 111.635
        const liquidatorBalance = await marginTracker_.userCollaterals(liquidator, USDC_);
        expect(liquidatorBalance).to.eq(usdcOf("95.515")); // 32.13 + 31.85 + 31.535
        expect(await positionManager_.isLiquidatable(account3)).to.eq(false);
    });
    it("liquidate and generate deficit loss", async () => {
        positionManager_ = positionManager_.connect(account4);
        // deposit margins
        await positionManager_.depositMargin(USDC_, usdcOf(1000), ZeroHash);

        let pythUpdateData = await getPythUpdateData(hre, { WETH: 1000 });
        // open eth long, 10000 notional
        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(10),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(0),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await positionManager_.executeOrder(orderId, pythUpdateData.updateData, { value: pythUpdateData.fee });

        pythUpdateData = await getPythUpdateData(hre, { WETH: 900, USDC: "0.8" });
        await priceOracle_.updatePythPrice(pythUpdateData.updateData, {
            value: pythUpdateData.fee,
        });

        // liquidate
        await expect(positionManager_.connect(liquidator).liquidatePosition(account4, WETH_, []))
            .to.emit(positionManager_, "Liquidated")
            .withArgs(account4, WETH_, normalized(10), normalized(9000), normalized("31.5"), normalized(90), 0)
            .to.emit(positionManager_, "LiquidationFee")
            .withArgs(account4, normalized(9000), normalized("31.5"), usdcOf("39.375"))
            .to.emit(positionManager_, "LiquidationPenalty")
            .withArgs(account4, normalized(9000), normalized(90), usdcOf("112.5"))
            .to.emit(marginTracker_, "DeficitLoss")
            .withArgs(account4, usdcOf("401.875"), usdcOf("250.915"), usdcOf("150.96"));
        const status = await market_.accountMarginStatus(account4);
        expect(status.currentMargin).to.eq(0);
        const userCollaterals = await marginTracker_.userCollaterals(account4, USDC_);
        expect(userCollaterals).to.eq(0);
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.eq(
            normalized("803047.232") // (1000000 + 820 + 900 + 990) * 0.8 + 1000 - 150.96 * 0.8
        );
        expect(globalStatus.netOpenInterest).to.eq(normalized(100));
        const insurance = await market_.insuranceBalance();
        expect(insurance).to.eq(0);
        const liquidatorBalance = await marginTracker_.userCollaterals(liquidator, USDC_);
        expect(liquidatorBalance).to.eq(usdcOf("134.89")); // 32.13 + 31.85 + 31.535 + 31.5 / 0.8
        expect(await positionManager_.isLiquidatable(account4)).to.eq(false);
    });
});
