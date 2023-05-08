import hre, { deployments } from "hardhat";
import { expect } from "chai";
import {
    CONTRACTS,
    MAX_UINT256,
    UNIT,
    getProxyContract,
    normalized,
} from "../src/utils/utils";
import {
    getPythUpdateData,
    increaseNextBlockTimestamp,
    setupPrices,
} from "../src/utils/test_utils";
import { ethers } from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { NetworkConfigs, getConfig } from "../src/config";

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
    let deployer: ethers.Signer;
    let liquidator: ethers.Signer;
    let config: NetworkConfigs;
    let market_: ethers.Contract;
    let perpTracker_: ethers.Contract;
    let priceOracle_: ethers.Contract;
    let positionManager_: ethers.Contract;
    let liquidityManager_: ethers.Contract;
    let marketSettings_: ethers.Contract;
    let WETH: string;
    let WBTC: string;
    let USDC_: ethers.Contract;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any

    before(async () => {
        deployer = (await hre.ethers.getSigners())[0];
        account1 = (await hre.ethers.getSigners())[1];
        account2 = (await hre.ethers.getSigners())[2];
        account3 = (await hre.ethers.getSigners())[3];
        account4 = (await hre.ethers.getSigners())[4];
        liquidator = (await hre.ethers.getSigners())[5];
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH = (await hre.ethers.getContract("WETH")).address;
        WBTC = (await hre.ethers.getContract("WBTC")).address;
        USDC_ = await hre.ethers.getContract("USDC", deployer);
        market_ = await getProxyContract(hre, CONTRACTS.Market, account1);
        perpTracker_ = await getProxyContract(
            hre,
            CONTRACTS.PerpTracker,
            account1
        );
        priceOracle_ = await getProxyContract(
            hre,
            CONTRACTS.PriceOracle,
            account1
        );
        marketSettings_ = await getProxyContract(
            hre,
            CONTRACTS.MarketSettings,
            deployer
        );
        liquidityManager_ = await getProxyContract(
            hre,
            CONTRACTS.LiquidityManager,
            account1
        );
        positionManager_ = await getProxyContract(
            hre,
            CONTRACTS.PositionManager,
            account1
        );
        config = getConfig(hre.network.name);

        for (let i = 1; i <= 4; ++i) {
            await (
                await USDC_.transfer(
                    await (await hre.ethers.getSigners())[i].getAddress(),
                    hre.ethers.BigNumber.from(100000000).mul(UNIT)
                )
            ).wait();
            await (
                await USDC_.connect((await hre.ethers.getSigners())[i]).approve(
                    market_.address,
                    MAX_UINT256
                )
            ).wait();
        }

        // add liquidity
        USDC_ = USDC_.connect(account1);
        const amount = hre.ethers.BigNumber.from(1000000).mul(UNIT); // 1M
        const minUsd = hre.ethers.BigNumber.from(100000).mul(UNIT);
        const minLp = hre.ethers.BigNumber.from(100000).mul(UNIT);
        await (
            await liquidityManager_.addLiquidity(
                amount,
                minUsd,
                minLp,
                await account1.getAddress()
            )
        ).wait();

        // set fee and slippage to zero for convenience
        await (
            await marketSettings_.setIntVals(
                hre.ethers.utils.formatBytes32String("maxFundingVelocity"),
                0
            )
        ).wait();
        await (
            await marketSettings_.setIntVals(
                hre.ethers.utils.formatBytes32String("maxFinancingFeeRate"),
                0
            )
        ).wait();
        await (
            await marketSettings_.setIntVals(
                hre.ethers.utils.formatBytes32String("maxSlippage"),
                0
            )
        ).wait();
        await (
            await marketSettings_.setIntVals(
                hre.ethers.utils.formatBytes32String("perpTradingFee"),
                0
            )
        ).wait();
        await (
            await marketSettings_.setIntVals(
                hre.ethers.utils.formatBytes32String("pythMaxAge"),
                1000000
            )
        ).wait();
        await (
            await marketSettings_.setIntVals(
                hre.ethers.utils.formatBytes32String("maxPriceDivergence"),
                normalized(1000)
            )
        ).wait();
    });

    it("liquidate and pay fee & penalty", async () => {
        // deposit margins
        await (
            await positionManager_.depositMargin(
                hre.ethers.BigNumber.from(1000).mul(UNIT),
                hre.ethers.constants.HashZero
            )
        ).wait();

        // open eth long, 10000 notional
        await (
            await positionManager_.submitOrder(
                WETH,
                normalized(10),
                normalized(1000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        let orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s

        await (await positionManager_.executeOrder(orderId, [])).wait();

        // open btc long, 100 notional
        await (
            await positionManager_.submitOrder(
                WBTC,
                normalized(0.01),
                normalized(10000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s

        await (await positionManager_.executeOrder(orderId, [])).wait();

        const pythUpdateData = await getPythUpdateData(hre, { WETH: 918 });
        await (
            await priceOracle_.updatePythPrice(
                await account1.getAddress(),
                pythUpdateData.updateData,
                { value: pythUpdateData.fee }
            )
        ).wait();

        // liquidate
        await expect(
            positionManager_
                .connect(liquidator)
                .liquidatePosition(await account1.getAddress(), WETH, [])
        )
            .to.emit(positionManager_, "Liquidated")
            .withArgs(
                await account1.getAddress(),
                WETH,
                normalized(9180),
                await liquidator.getAddress(),
                normalized(32.13),
                normalized(91.8),
                normalized(0),
                0
            )
            .to.emit(positionManager_, "LiquidationFee")
            .withArgs(
                await account1.getAddress(),
                normalized(9180),
                await liquidator.getAddress(),
                normalized(32.13),
                normalized(32.13),
                normalized(0),
                normalized(0)
            )
            .to.emit(positionManager_, "LiquidationPenalty")
            .withArgs(
                await account1.getAddress(),
                normalized(9180),
                await liquidator.getAddress(),
                normalized(91.8),
                normalized(91.8)
            );
        const status = await market_.accountMarginStatus(
            await account1.getAddress()
        );
        expect(status.currentMargin).to.deep.eq(normalized(56.07));
        const userMargin = await perpTracker_.userMargin(
            await account1.getAddress()
        );
        expect(userMargin).to.deep.eq(normalized(56.07));
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq(normalized(1000000 + 820));
        expect(globalStatus.netOpenInterest).to.deep.eq(normalized(100));
        const insurance = await market_.insuranceBalance();
        expect(insurance).to.deep.eq(normalized(91.8));
        const liquidatorBalance = await USDC_.balanceOf(
            await liquidator.getAddress()
        );
        expect(liquidatorBalance).to.deep.eq(normalized(32.13));
        expect(
            await positionManager_.isLiquidatable(await account1.getAddress())
        ).to.eq(false);
    });
    it("liquidate and pay fee, insufficient to pay penalty", async () => {
        positionManager_ = positionManager_.connect(account2);
        // deposit margins
        await (
            await positionManager_.depositMargin(
                hre.ethers.BigNumber.from(1000).mul(UNIT),
                hre.ethers.constants.HashZero
            )
        ).wait();

        let pythUpdateData = await getPythUpdateData(hre, { WETH: 1000 });
        // open eth long, 10000 notional
        await (
            await positionManager_.submitOrder(
                WETH,
                normalized(10),
                normalized(1000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        const orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s

        await (
            await positionManager_.executeOrder(
                orderId,
                pythUpdateData.updateData,
                { value: pythUpdateData.fee }
            )
        ).wait();

        pythUpdateData = await getPythUpdateData(hre, { WETH: 910 });
        await (
            await priceOracle_.updatePythPrice(
                await account2.getAddress(),
                pythUpdateData.updateData,
                { value: pythUpdateData.fee }
            )
        ).wait();

        // liquidate
        await expect(
            positionManager_
                .connect(liquidator)
                .liquidatePosition(await account2.getAddress(), WETH, [])
        )
            .to.emit(positionManager_, "Liquidated")
            .withArgs(
                await account2.getAddress(),
                WETH,
                normalized(9100),
                await liquidator.getAddress(),
                normalized(31.85),
                normalized(68.15),
                normalized(0),
                0
            )
            .to.emit(positionManager_, "LiquidationFee")
            .withArgs(
                await account2.getAddress(),
                normalized(9100),
                await liquidator.getAddress(),
                normalized(31.85),
                normalized(31.85),
                normalized(0),
                normalized(0)
            )
            .to.emit(positionManager_, "LiquidationPenalty")
            .withArgs(
                await account2.getAddress(),
                normalized(9100),
                await liquidator.getAddress(),
                normalized(68.15),
                normalized(68.15)
            );
        const status = await market_.accountMarginStatus(
            await account2.getAddress()
        );
        expect(status.currentMargin).to.deep.eq(normalized(0));
        const userMargin = await perpTracker_.userMargin(
            await account2.getAddress()
        );
        expect(userMargin).to.deep.eq(normalized(0));
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq(
            normalized(1001720) // 1000000 + 820 + 900
        );
        expect(globalStatus.netOpenInterest).to.deep.eq(normalized(100));
        const insurance = await market_.insuranceBalance();
        expect(insurance).to.deep.eq(normalized(159.95)); // 91.8 + 68.15
        const liquidatorBalance = await USDC_.balanceOf(
            await liquidator.getAddress()
        );
        expect(liquidatorBalance).to.deep.eq(normalized(63.98)); // 32.13 + 31.85
        expect(
            await positionManager_.isLiquidatable(await account2.getAddress())
        ).to.eq(false);
    });
    it("liquidate but insufficient to pay fee and penalty", async () => {
        positionManager_ = positionManager_.connect(account3);
        // deposit margins
        await (
            await positionManager_.depositMargin(
                hre.ethers.BigNumber.from(1000).mul(UNIT),
                hre.ethers.constants.HashZero
            )
        ).wait();

        let pythUpdateData = await getPythUpdateData(hre, { WETH: 1000 });
        // open eth long, 10000 notional
        await (
            await positionManager_.submitOrder(
                WETH,
                normalized(10),
                normalized(1000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        const orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s

        await (
            await positionManager_.executeOrder(
                orderId,
                pythUpdateData.updateData,
                { value: pythUpdateData.fee }
            )
        ).wait();

        pythUpdateData = await getPythUpdateData(hre, { WETH: 901 });
        await (
            await priceOracle_.updatePythPrice(
                await account3.getAddress(),
                pythUpdateData.updateData,
                { value: pythUpdateData.fee }
            )
        ).wait();

        // liquidate
        await expect(
            positionManager_
                .connect(liquidator)
                .liquidatePosition(await account3.getAddress(), WETH, [])
        )
            .to.emit(positionManager_, "Liquidated")
            .withArgs(
                await account3.getAddress(),
                WETH,
                normalized(9010),
                await liquidator.getAddress(),
                normalized(31.535),
                normalized(0),
                normalized(0),
                0
            )
            .to.emit(positionManager_, "LiquidationFee")
            .withArgs(
                await account3.getAddress(),
                normalized(9010),
                await liquidator.getAddress(),
                normalized(31.535),
                normalized(10),
                normalized(21.535),
                normalized(0)
            );
        const status = await market_.accountMarginStatus(
            await account3.getAddress()
        );
        expect(status.currentMargin).to.deep.eq(normalized(0));
        const userMargin = await perpTracker_.userMargin(
            await account3.getAddress()
        );
        expect(userMargin).to.deep.eq(normalized(0));
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq(
            normalized(1002710) // 1000000 + 820 + 900 + 990
        );
        expect(globalStatus.netOpenInterest).to.deep.eq(normalized(100));
        const insurance = await market_.insuranceBalance();
        expect(insurance).to.deep.eq(normalized(138.415)); // 91.8 + 68.15 - 21.535
        const liquidatorBalance = await USDC_.balanceOf(
            await liquidator.getAddress()
        );
        expect(liquidatorBalance).to.deep.eq(normalized(95.515)); // 32.13 + 31.85 + 31.535
        expect(
            await positionManager_.isLiquidatable(await account3.getAddress())
        ).to.eq(false);
    });
    it("liquidate and generate deficit loss", async () => {
        positionManager_ = positionManager_.connect(account4);
        // deposit margins
        await (
            await positionManager_.depositMargin(
                hre.ethers.BigNumber.from(1000).mul(UNIT),
                hre.ethers.constants.HashZero
            )
        ).wait();

        let pythUpdateData = await getPythUpdateData(hre, { WETH: 1000 });
        // open eth long, 10000 notional
        await (
            await positionManager_.submitOrder(
                WETH,
                normalized(10),
                normalized(1000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        const orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s

        await (
            await positionManager_.executeOrder(
                orderId,
                pythUpdateData.updateData,
                { value: pythUpdateData.fee }
            )
        ).wait();

        pythUpdateData = await getPythUpdateData(hre, { WETH: 900, USDC: 0.8 });
        await (
            await priceOracle_.updatePythPrice(
                await account4.getAddress(),
                pythUpdateData.updateData,
                { value: pythUpdateData.fee }
            )
        ).wait();

        // liquidate
        await expect(
            positionManager_
                .connect(liquidator)
                .liquidatePosition(await account4.getAddress(), WETH, [])
        )
            .to.emit(positionManager_, "Liquidated")
            .withArgs(
                await account4.getAddress(),
                WETH,
                normalized(9000),
                await liquidator.getAddress(),
                normalized(31.5),
                normalized(0),
                normalized(200),
                0
            )
            .to.emit(positionManager_, "DeficitLoss")
            .withArgs(
                await account4.getAddress(),
                normalized(200),
                normalized(138.415),
                normalized(111.585)
            )
            .to.emit(positionManager_, "LiquidationFee")
            .withArgs(
                await account4.getAddress(),
                normalized(9000),
                await liquidator.getAddress(),
                normalized(31.5),
                normalized(0),
                normalized(0),
                normalized(39.375)
            );
        const status = await market_.accountMarginStatus(
            await account4.getAddress()
        );
        expect(status.currentMargin).to.deep.eq(normalized(0));
        const userMargin = await perpTracker_.userMargin(
            await account4.getAddress()
        );
        expect(userMargin).to.deep.eq(normalized(0));
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq(
            normalized(803047.232) // (1000000 + 820 + 900 + 990) * 0.8 + 1000 - 89.268 - 31.5
        );
        expect(globalStatus.netOpenInterest).to.deep.eq(normalized(100));
        const insurance = await market_.insuranceBalance();
        expect(insurance).to.deep.eq(normalized(0));
        const liquidatorBalance = await USDC_.balanceOf(
            await liquidator.getAddress()
        );
        expect(liquidatorBalance).to.deep.eq(normalized(134.89)); // 32.13 + 31.85 + 31.535 + 31.5 / 0.8
        expect(
            await positionManager_.isLiquidatable(await account4.getAddress())
        ).to.eq(false);
    });
});
