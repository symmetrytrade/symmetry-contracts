import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "ethers";
import hre, { deployments } from "hardhat";
import { getConfig, NetworkConfigs } from "../src/config";
import {
    getPythUpdateData,
    increaseNextBlockTimestamp,
    setPythAutoRefresh,
    setupPrices,
} from "../src/utils/test_utils";
import { CONTRACTS, getTypedContract, MAX_UINT256, normalized, usdcOf } from "../src/utils/utils";
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
    let account1: ethers.Signer;
    let account2: ethers.Signer;
    let account3: ethers.Signer;
    let account4: ethers.Signer;
    let liquidator: ethers.Signer;
    let config: NetworkConfigs;
    let market_: Market;
    let priceOracle_: PriceOracle;
    let positionManager_: PositionManager;
    let liquidityManager_: LiquidityManager;
    let marketSettings_: MarketSettings;
    let marginTracker_: MarginTracker;
    let WETH: string;
    let WBTC: string;
    let USDC_: FaucetToken;

    before(async () => {
        account1 = (await hre.ethers.getSigners())[1];
        account2 = (await hre.ethers.getSigners())[2];
        account3 = (await hre.ethers.getSigners())[3];
        account4 = (await hre.ethers.getSigners())[4];
        liquidator = (await hre.ethers.getSigners())[5];
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH = await (await getTypedContract(hre, CONTRACTS.WETH)).getAddress();
        WBTC = await (await getTypedContract(hre, CONTRACTS.WBTC)).getAddress();
        USDC_ = await getTypedContract(hre, CONTRACTS.USDC);
        market_ = await getTypedContract(hre, CONTRACTS.Market, account1);
        priceOracle_ = await getTypedContract(hre, CONTRACTS.PriceOracle, account1);
        marketSettings_ = await getTypedContract(hre, CONTRACTS.MarketSettings);
        liquidityManager_ = await getTypedContract(hre, CONTRACTS.LiquidityManager, account1);
        positionManager_ = await getTypedContract(hre, CONTRACTS.PositionManager, account1);
        marginTracker_ = await getTypedContract(hre, CONTRACTS.MarginTracker, account1);
        config = getConfig(hre.network.name);

        for (let i = 1; i <= 4; ++i) {
            await USDC_.transfer(await (await hre.ethers.getSigners())[i].getAddress(), usdcOf(100000000));
            await USDC_.connect((await hre.ethers.getSigners())[i]).approve(await market_.getAddress(), MAX_UINT256);
        }

        // add liquidity
        USDC_ = USDC_.connect(account1);
        const amount = usdcOf(1000000); // 1M
        const minLp = normalized(100000);
        await liquidityManager_.addLiquidity(amount, minLp, await account1.getAddress(), false);

        // set fee and slippage to zero for convenience
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxFundingVelocity")], [0]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxFinancingFeeRate")], [0]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("liquidityRange")], [0]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("perpTradingFee")], [0]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("pythMaxAge")], [1000000]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("minKeeperFee")], [normalized(0)]);
        // set debt interest rate to 0%
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("minInterestRate")], [0]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxInterestRate")], [0]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("vertexInterestRate")], [0]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxPriceDivergence")], [normalized(1000)]);
        await setPythAutoRefresh(hre);
    });

    it("liquidate and pay fee & penalty", async () => {
        // deposit margins
        await positionManager_.depositMargin(await USDC_.getAddress(), usdcOf(1000), hre.ethers.ZeroHash);

        // open eth long, 10000 notional
        await positionManager_.submitOrder({
            token: WETH,
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
            token: WBTC,
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
        await expect(positionManager_.connect(liquidator).liquidatePosition(await account1.getAddress(), WETH, []))
            .to.emit(positionManager_, "Liquidated")
            .withArgs(
                await account1.getAddress(),
                WETH,
                normalized(10),
                normalized(9180),
                normalized("32.13"),
                normalized("91.8"),
                0
            )
            .to.emit(positionManager_, "LiquidationFee")
            .withArgs(await account1.getAddress(), normalized(9180), normalized("32.13"), usdcOf("32.13"))
            .to.emit(positionManager_, "LiquidationPenalty")
            .withArgs(await account1.getAddress(), normalized(9180), normalized("91.8"), usdcOf("91.8"));
        const status = await market_.accountMarginStatus(await account1.getAddress());
        expect(status.currentMargin).to.eq(normalized("56.07"));
        const userCollaterals = await marginTracker_.userCollaterals(
            await account1.getAddress(),
            await USDC_.getAddress()
        );
        expect(userCollaterals).to.eq(usdcOf("56.07"));
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.eq(normalized(1000000 + 820));
        expect(globalStatus.netOpenInterest).to.eq(normalized(100));
        const insurance = await market_.insuranceBalance();
        expect(insurance).to.eq(usdcOf("91.8"));
        const liquidatorBalance = await marginTracker_.userCollaterals(
            await liquidator.getAddress(),
            await USDC_.getAddress()
        );
        expect(liquidatorBalance).to.eq(usdcOf("32.13"));
        expect(await positionManager_.isLiquidatable(await account1.getAddress())).to.eq(false);
    });
    it("liquidate and pay fee, insufficient to pay all penalty", async () => {
        positionManager_ = positionManager_.connect(account2);
        // deposit margins
        await positionManager_.depositMargin(await USDC_.getAddress(), usdcOf(1000), hre.ethers.ZeroHash);

        let pythUpdateData = await getPythUpdateData(hre, { WETH: 1000 });
        // open eth long, 10000 notional
        await positionManager_.submitOrder({
            token: WETH,
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
        await expect(positionManager_.connect(liquidator).liquidatePosition(await account2.getAddress(), WETH, []))
            .to.emit(positionManager_, "Liquidated")
            .withArgs(
                await account2.getAddress(),
                WETH,
                normalized(10),
                normalized(9100),
                normalized("31.85"),
                normalized(91),
                0
            )
            .to.emit(positionManager_, "LiquidationFee")
            .withArgs(await account2.getAddress(), normalized(9100), normalized("31.85"), usdcOf("31.85"))
            .to.emit(positionManager_, "LiquidationPenalty")
            .withArgs(await account2.getAddress(), normalized(9100), normalized(91), usdcOf(91))
            .to.emit(marginTracker_, "DeficitLoss")
            .withArgs(await account2.getAddress(), usdcOf("22.85"), usdcOf("22.85"), 0);
        const status = await market_.accountMarginStatus(await account2.getAddress());
        expect(status.currentMargin).to.eq(0);
        const userCollaterals = await marginTracker_.userCollaterals(
            await account2.getAddress(),
            await USDC_.getAddress()
        );
        expect(userCollaterals).to.eq(0);
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.eq(
            normalized(1001720) // 1000000 + 820 + 900
        );
        expect(globalStatus.netOpenInterest).to.eq(normalized(100));
        const insurance = await market_.insuranceBalance();
        expect(insurance).to.eq(usdcOf("159.95")); // 91.8 + 91 - 22.85
        const liquidatorBalance = await marginTracker_.userCollaterals(
            await liquidator.getAddress(),
            await USDC_.getAddress()
        );
        expect(liquidatorBalance).to.eq(usdcOf("63.98")); // 32.13 + 31.85
        expect(await positionManager_.isLiquidatable(await account2.getAddress())).to.eq(false);
    });
    it("liquidate but insufficient to pay fee and penalty", async () => {
        positionManager_ = positionManager_.connect(account3);
        // deposit margins
        await positionManager_.depositMargin(await USDC_.getAddress(), usdcOf(1000), hre.ethers.ZeroHash);

        let pythUpdateData = await getPythUpdateData(hre, { WETH: 1000 });
        // open eth long, 10000 notional
        await positionManager_.submitOrder({
            token: WETH,
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
        await expect(positionManager_.connect(liquidator).liquidatePosition(await account3.getAddress(), WETH, []))
            .to.emit(positionManager_, "Liquidated")
            .withArgs(
                await account3.getAddress(),
                WETH,
                normalized(10),
                normalized(9010),
                normalized("31.535"),
                normalized("90.1"),
                0
            )
            .to.emit(positionManager_, "LiquidationFee")
            .withArgs(await account3.getAddress(), normalized(9010), normalized("31.535"), usdcOf("31.535"))
            .to.emit(positionManager_, "LiquidationPenalty")
            .withArgs(await account3.getAddress(), normalized(9010), normalized("90.1"), usdcOf("90.1"))
            .to.emit(marginTracker_, "DeficitLoss")
            .withArgs(await account3.getAddress(), usdcOf("111.635"), usdcOf("111.635"), 0);
        const status = await market_.accountMarginStatus(await account3.getAddress());
        expect(status.currentMargin).to.eq(0);
        const userCollaterals = await marginTracker_.userCollaterals(
            await account3.getAddress(),
            await USDC_.getAddress()
        );
        expect(userCollaterals).to.eq(0);
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.eq(
            normalized(1002710) // 1000000 + 820 + 900 + 990
        );
        expect(globalStatus.netOpenInterest).to.eq(normalized(100));
        const insurance = await market_.insuranceBalance();
        expect(insurance).to.eq(usdcOf("138.415")); // 91.8 + 91 - 22.85 + 90.1 - 111.635
        const liquidatorBalance = await marginTracker_.userCollaterals(
            await liquidator.getAddress(),
            await USDC_.getAddress()
        );
        expect(liquidatorBalance).to.eq(usdcOf("95.515")); // 32.13 + 31.85 + 31.535
        expect(await positionManager_.isLiquidatable(await account3.getAddress())).to.eq(false);
    });
    it("liquidate and generate deficit loss", async () => {
        positionManager_ = positionManager_.connect(account4);
        // deposit margins
        await positionManager_.depositMargin(await USDC_.getAddress(), usdcOf(1000), hre.ethers.ZeroHash);

        let pythUpdateData = await getPythUpdateData(hre, { WETH: 1000 });
        // open eth long, 10000 notional
        await positionManager_.submitOrder({
            token: WETH,
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
        await expect(positionManager_.connect(liquidator).liquidatePosition(await account4.getAddress(), WETH, []))
            .to.emit(positionManager_, "Liquidated")
            .withArgs(
                await account4.getAddress(),
                WETH,
                normalized(10),
                normalized(9000),
                normalized("31.5"),
                normalized(90),
                0
            )
            .to.emit(positionManager_, "LiquidationFee")
            .withArgs(await account4.getAddress(), normalized(9000), normalized("31.5"), usdcOf("39.375"))
            .to.emit(positionManager_, "LiquidationPenalty")
            .withArgs(await account4.getAddress(), normalized(9000), normalized(90), usdcOf("112.5"))
            .to.emit(marginTracker_, "DeficitLoss")
            .withArgs(await account4.getAddress(), usdcOf("401.875"), usdcOf("250.915"), usdcOf("150.96"));
        const status = await market_.accountMarginStatus(await account4.getAddress());
        expect(status.currentMargin).to.eq(0);
        const userCollaterals = await marginTracker_.userCollaterals(await account4.getAddress(), USDC_.getAddress());
        expect(userCollaterals).to.eq(0);
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.eq(
            normalized("803047.232") // (1000000 + 820 + 900 + 990) * 0.8 + 1000 - 150.96 * 0.8
        );
        expect(globalStatus.netOpenInterest).to.eq(normalized(100));
        const insurance = await market_.insuranceBalance();
        expect(insurance).to.eq(0);
        const liquidatorBalance = await marginTracker_.userCollaterals(
            await liquidator.getAddress(),
            USDC_.getAddress()
        );
        expect(liquidatorBalance).to.eq(usdcOf("134.89")); // 32.13 + 31.85 + 31.535 + 31.5 / 0.8
        expect(await positionManager_.isLiquidatable(await account4.getAddress())).to.eq(false);
    });
});
