import hre, { deployments } from "hardhat";
import { expect } from "chai";
import {
    ADDR0,
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
    let WETH: string;
    let WBTC: string;
    let USDC_: ethers.Contract;
    let feeTracker_: ethers.Contract;

    before(async () => {
        deployer = (await hre.ethers.getSigners())[0];
        account1 = (await hre.ethers.getSigners())[1];
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
        feeTracker_ = await getProxyContract(
            hre,
            CONTRACTS.FeeTracker,
            account1
        );
        config = getConfig(hre.network.name);

        await (
            await USDC_.transfer(
                await account1.getAddress(),
                hre.ethers.BigNumber.from(100000000).mul(UNIT)
            )
        ).wait();

        // add liquidity
        USDC_ = USDC_.connect(account1);
        await (await USDC_.approve(market_.address, MAX_UINT256)).wait();
        const amount = hre.ethers.BigNumber.from(1000000).mul(UNIT);
        const minUsd = hre.ethers.BigNumber.from(980000).mul(UNIT);
        const minLp = hre.ethers.BigNumber.from(980000).mul(UNIT);
        await (
            await liquidityManager_.addLiquidity(
                amount,
                minUsd,
                minLp,
                await account1.getAddress()
            )
        ).wait();
    });

    it("getPrice", async () => {
        let price = await priceOracle_.getPrice(WETH, false);
        expect(price.div(UNIT)).to.deep.eq(1499);

        await increaseNextBlockTimestamp(config.marketGeneralConfig.pythMaxAge);

        price = await priceOracle_.getPrice(WETH, false);
        expect(price.div(UNIT)).to.deep.eq(1499);

        await setupPrices(hre, { WETH: 1500 }, {}, account1);
        price = await priceOracle_.getPrice(WETH, false);
        expect(price.div(UNIT)).to.deep.eq(1500);

        await expect(priceOracle_.getPrice(WETH, true)).to.be.revertedWith(
            "PriceOracle: pyth price too stale"
        );

        await setupPrices(hre, {}, { WETH: 1300 }, account1);
        await expect(priceOracle_.getPrice(WETH, false)).to.be.revertedWith(
            "PriceOracle: oracle price divergence too large"
        );

        await setupPrices(hre, {}, { WETH: 1600 }, account1);
        await expect(priceOracle_.getPrice(WETH, false)).to.be.revertedWith(
            "PriceOracle: oracle price divergence too large"
        );

        await setupPrices(hre, {}, { WETH: 1500 }, account1);

        // for convenience of following test, set divergence to 200%
        await (
            await marketSettings_.setIntVals(
                hre.ethers.utils.formatBytes32String("maxPriceDivergence"),
                normalized(2)
            )
        ).wait();
    });

    it("tokenToUsd", async () => {
        let usdAmount = await market_.tokenToUsd(
            WETH,
            hre.ethers.BigNumber.from(2).mul(UNIT),
            false
        );
        expect(usdAmount.div(UNIT)).to.deep.eq(3000);
        usdAmount = await market_.tokenToUsd(
            WETH,
            hre.ethers.BigNumber.from(-5).mul(UNIT),
            false
        );
        expect(usdAmount.div(UNIT)).to.deep.eq(-7500);
    });

    it("usdToToken", async () => {
        let tokenAmount = await market_.usdToToken(
            WETH,
            hre.ethers.BigNumber.from(3000).mul(UNIT),
            false
        );
        expect(tokenAmount.div(UNIT)).to.deep.eq(2);
        tokenAmount = await market_.usdToToken(
            WETH,
            hre.ethers.BigNumber.from(-7500).mul(UNIT),
            false
        );
        expect(tokenAmount.div(UNIT)).to.deep.eq(-5);
    });

    it("trade ETH long", async () => {
        await (
            await positionManager_.depositMargin(
                hre.ethers.BigNumber.from(1500).mul(UNIT),
                hre.ethers.constants.HashZero
            )
        ).wait();
        let status = await market_.accountMarginStatus(
            await account1.getAddress()
        );
        expect(status.currentMargin).to.deep.eq(normalized(1470));

        await (
            await positionManager_.submitOrder(
                WETH,
                normalized(10),
                normalized(1550),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        const orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s

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
                "1505739795918367345500", // avg price
                "15057397959183673455", // trading fee
                "0"
            );
        const userMargin = await perpTracker_.userMargin(
            await account1.getAddress()
        );
        expect(userMargin).to.deep.eq(normalized(1500));
        const position = await perpTracker_.getPosition(
            await account1.getAddress(),
            WETH
        );
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
        expect(globalStatus.netOpenInterest).to.deep.eq(
            "15000000000000000000000"
        );
        await increaseNextBlockTimestamp(5); // 5s
        await expect(
            positionManager_.executeOrder(orderId, pythUpdateData.updateData, {
                value: pythUpdateData.fee,
            })
        ).to.be.revertedWith("PositionManager: order is not pending");
    });
    it("trade BTC short revert", async () => {
        await increaseNextBlockTimestamp(5); // 5s
        await (
            await positionManager_.submitOrder(
                WBTC,
                normalized(-2),
                normalized(15000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        const orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s

        const pythUpdateData = await getPythUpdateData(hre, { WBTC: 20000 });
        await expect(
            positionManager_.executeOrder(orderId, pythUpdateData.updateData, {
                value: pythUpdateData.fee,
            })
        ).to.be.revertedWith("PositionManager: leverage ratio too large");
        await increaseNextBlockTimestamp(100); // 100s
        await expect(
            positionManager_.executeOrder(orderId, pythUpdateData.updateData, {
                value: pythUpdateData.fee,
            })
        ).to.be.revertedWith("PositionManager: order expired");
    });
    it("trade BTC short", async () => {
        await increaseNextBlockTimestamp(10); // 10s
        await (
            await positionManager_.submitOrder(
                WBTC,
                normalized(-0.5),
                normalized(15000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        const orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s

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
                "19948983377533991640000", // avg price
                "9974491688766995820", // trading fee
                "0"
            );
        const userMargin = await perpTracker_.userMargin(
            await account1.getAddress()
        );
        expect(userMargin).to.deep.eq(normalized(1500));
        const position = await perpTracker_.getPosition(
            await account1.getAddress(),
            WBTC
        );
        expect(position.accFunding).to.deep.eq(0);
        expect(position.avgPrice).to.deep.eq("19929034394156457648360");
        // funding of ETH position
        // since the long ETH trade, there should be 5+5+60+100+10+60=240s passed
        const fs = await perpTracker_.nextAccFunding(WETH, normalized(1500));
        expect(fs[0]).to.deep.eq("12754159074335926"); // next funding rate
        expect(fs[1]).to.deep.eq("26571164738199000"); // acc funding
        // margin status
        const status = await market_.accountMarginStatus(
            await account1.getAddress()
        );
        expect(status.currentMargin).to.deep.eq("1361796128287989705730");
        expect(status.positionNotional).to.deep.eq("25000000000000000000000");
        const lpPosition = await perpTracker_.getLpPosition(WBTC);
        expect(lpPosition.longSize).to.deep.eq(normalized(0.5));
        expect(lpPosition.shortSize).to.deep.eq(0);
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq("980108203871712010294270");
        expect(globalStatus.netOpenInterest).to.deep.eq(
            "25000000000000000000000"
        );
    });

    it("close BTC short", async () => {
        await increaseNextBlockTimestamp(10); // 10s
        await (
            await positionManager_.submitOrder(
                WBTC,
                normalized(0.5),
                normalized(25000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        const orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s

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
                "15000000000000000000000", // avg price
                "7500000000000000000", // trading fee
                "0"
            );
        // funding of BTC position
        // since the short BTC trade, there should be 10 + 60 = 70s passed
        const fs = await perpTracker_.nextAccFunding(WBTC, normalized(15000));
        expect(fs[0]).to.deep.eq("-2479884920822164"); // next funding rate
        expect(fs[1]).to.deep.eq("-15068745178605000"); // acc funding
        const userMargin = await perpTracker_.userMargin(
            await account1.getAddress()
        );
        expect(userMargin).to.deep.eq("4007152717046570940490");
        const position = await perpTracker_.getPosition(
            await account1.getAddress(),
            WBTC
        );
        expect(position.accFunding).to.deep.eq("-15068745178605000");
        expect(position.avgPrice).to.deep.eq("15015000000000000000000");
        // margin status
        const status = await market_.accountMarginStatus(
            await account1.getAddress()
        );
        expect(status.currentMargin).to.deep.eq("3854110991512202358230");
        expect(status.positionNotional).to.deep.eq(normalized(15000));
        const lpPosition = await perpTracker_.getLpPosition(WBTC);
        expect(lpPosition.longSize).to.deep.eq(0);
        expect(lpPosition.shortSize).to.deep.eq(0);
        expect(lpPosition.avgPrice).to.deep.eq("15015000000000000000000");
        expect(lpPosition.accFunding).to.deep.eq("-15068745178605000");
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq("977615889008487797641769");
        expect(globalStatus.netOpenInterest).to.deep.eq(
            "15000000000000000000000"
        );
    });
    it("set functions", async () => {
        market_ = market_.connect(deployer);
        await market_.setOracle(ADDR0);
        expect(await market_.priceOracle()).to.eq(ADDR0);
        await market_.setSetting(ADDR0);
        expect(await market_.settings()).to.eq(ADDR0);

        feeTracker_ = feeTracker_.connect(deployer);
        await feeTracker_.setMarket(ADDR0);
        expect(await feeTracker_.market()).to.eq(ADDR0);
        await feeTracker_.setPerpTracker(ADDR0);
        expect(await feeTracker_.perpTracker()).to.eq(ADDR0);
        await feeTracker_.setSetting(ADDR0);
        expect(await feeTracker_.settings()).to.eq(ADDR0);
    });
});
