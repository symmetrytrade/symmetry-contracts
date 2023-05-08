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

describe("Position", () => {
    let account1: ethers.Signer;
    let account2: ethers.Signer;
    let deployer: ethers.Signer;
    let config: NetworkConfigs;
    let market_: ethers.Contract;
    let perpTracker_: ethers.Contract;
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

        await (
            await USDC_.transfer(
                await account1.getAddress(),
                hre.ethers.BigNumber.from(100000000).mul(UNIT)
            )
        ).wait();
        await (
            await USDC_.transfer(
                await account2.getAddress(),
                hre.ethers.BigNumber.from(100000000).mul(UNIT)
            )
        ).wait();

        // add liquidity
        USDC_ = USDC_.connect(account1);
        await (await USDC_.approve(market_.address, MAX_UINT256)).wait();
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

        await (
            await USDC_.connect(account2).approve(market_.address, MAX_UINT256)
        ).wait();

        // set funding rate, fee and slippage to zero for convenience
        await (
            await marketSettings_.setIntVals(
                hre.ethers.utils.formatBytes32String("maxFundingVelocity"),
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
        // deposit margins
        await (
            await positionManager_.depositMargin(
                hre.ethers.BigNumber.from(1000000).mul(UNIT),
                hre.ethers.constants.HashZero
            )
        ).wait();

        await (
            await positionManager_
                .connect(account2)
                .depositMargin(
                    hre.ethers.BigNumber.from(1000000).mul(UNIT),
                    hre.ethers.constants.HashZero
                )
        ).wait();
    });
    it("lp limit for token", async () => {
        await (
            await positionManager_.submitOrder(
                WETH,
                normalized(701),
                normalized(1000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        let orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s

        await expect(
            positionManager_.executeOrder(orderId, [])
        ).to.be.revertedWith("PositionManager: position size exceeds limit");

        await (
            await positionManager_.submitOrder(
                WETH,
                normalized(-701),
                normalized(1000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s

        await expect(
            positionManager_.executeOrder(orderId, [])
        ).to.be.revertedWith("PositionManager: position size exceeds limit");
    });
    it("account1 open eth long", async () => {
        // trade eth long
        await (
            await positionManager_.submitOrder(
                WETH,
                normalized(600),
                normalized(1000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        const orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s

        await expect(positionManager_.executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(
                await account1.getAddress(),
                WETH,
                normalized(600),
                normalized(1000), // avg price
                0, // trading fee
                0
            );
        let tokenInfo = await perpTracker_.getTokenInfo(WETH);
        let feeInfo = await perpTracker_.getFeeInfo(WETH);
        expect(tokenInfo.lpNetValue).to.deep.eq(normalized(1000000));
        expect(tokenInfo.netOpenInterest).to.deep.eq(normalized(600000));
        expect(tokenInfo.skew).to.deep.eq(normalized(600000));
        expect(feeInfo.accLongFinancingFee).to.deep.eq(0);
        expect(feeInfo.accShortFinancingFee).to.deep.eq(0);
        // check financing fee rate
        await increaseNextBlockTimestamp(1); // 1s
        await (await market_.updateInfoWithPrice(WETH, [])).wait();

        tokenInfo = await perpTracker_.getTokenInfo(WETH);
        feeInfo = await perpTracker_.getFeeInfo(WETH);
        expect(tokenInfo.lpNetValue).to.deep.eq("1000000041666666666400000");
        expect(tokenInfo.netOpenInterest).to.deep.eq(normalized(600000));
        expect(tokenInfo.skew).to.deep.eq(normalized(600000));
        expect(feeInfo.accLongFinancingFee).to.deep.eq("69444444444000");
        expect(feeInfo.accShortFinancingFee).to.deep.eq(0);

        // check btc financing fee
        await increaseNextBlockTimestamp(1); // 1s
        await (await market_.updateInfoWithPrice(WBTC, [])).wait();

        tokenInfo = await perpTracker_.getTokenInfo(WBTC);
        feeInfo = await perpTracker_.getFeeInfo(WBTC);
        expect(tokenInfo.lpNetValue).to.deep.eq("1000000083333321179800000");
        expect(tokenInfo.netOpenInterest).to.deep.eq(normalized(600000));
        expect(tokenInfo.skew).to.deep.eq(0);
        expect(feeInfo.accLongFinancingFee).to.deep.eq(0);
        expect(feeInfo.accShortFinancingFee).to.deep.eq(0);
    });

    it("exceed hard limit", async () => {
        // trade btc short but exceed hard limit
        await increaseNextBlockTimestamp(10); // 10s
        await (
            await positionManager_.submitOrder(
                WBTC,
                normalized(-60),
                normalized(1000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        const orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s

        await expect(
            positionManager_.executeOrder(orderId, [])
        ).to.be.revertedWith("PositionManager: open interest exceed hardlimit");
    });
    it("account2 open btc short", async () => {
        positionManager_ = positionManager_.connect(account2);
        // trade btc short
        await increaseNextBlockTimestamp(10); // 10s
        await (
            await positionManager_.submitOrder(
                WBTC,
                normalized(-20),
                normalized(10000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        const orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s

        await expect(positionManager_.executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(
                await account2.getAddress(),
                WBTC,
                normalized(-20),
                normalized(10000), // avg price
                0, // trading fee
                0
            );
        let tokenInfo = await perpTracker_.getTokenInfo(WBTC);
        let feeInfo = await perpTracker_.getFeeInfo(WBTC);
        expect(tokenInfo.lpNetValue).to.deep.eq("1000005916664953124800000");
        expect(tokenInfo.netOpenInterest).to.deep.eq(normalized(800000));
        expect(tokenInfo.skew).to.deep.eq(normalized(-200000));
        expect(feeInfo.accLongFinancingFee).to.deep.eq(0);
        expect(feeInfo.accShortFinancingFee).to.deep.eq(0);
        // check financing fee rate
        await increaseNextBlockTimestamp(1); // 1s
        await (await market_.updateInfoWithPrice(WBTC, [])).wait();

        tokenInfo = await perpTracker_.getTokenInfo(WBTC);
        feeInfo = await perpTracker_.getFeeInfo(WBTC);
        expect(tokenInfo.lpNetValue).to.deep.eq("1000005972220195218400000");
        expect(tokenInfo.netOpenInterest).to.deep.eq(normalized(800000));
        expect(tokenInfo.skew).to.deep.eq(normalized(-200000));
        expect(feeInfo.accLongFinancingFee).to.deep.eq(0);
        expect(feeInfo.accShortFinancingFee).to.deep.eq("694429379010000");

        // check eth financing fee
        await increaseNextBlockTimestamp(1); // 1s
        await (await market_.updateInfoWithPrice(WETH, [])).wait();

        tokenInfo = await perpTracker_.getTokenInfo(WETH);
        feeInfo = await perpTracker_.getFeeInfo(WETH);
        expect(tokenInfo.lpNetValue).to.deep.eq("1000006027775434483400000");
        expect(tokenInfo.netOpenInterest).to.deep.eq(normalized(800000));
        expect(tokenInfo.skew).to.deep.eq(normalized(600000));
        expect(feeInfo.accLongFinancingFee).to.deep.eq("9999997103587000");
        expect(feeInfo.accShortFinancingFee).to.deep.eq(0);
    });
    it("account1 open btc long", async () => {
        positionManager_ = positionManager_.connect(account1);
        // trade btc short
        await increaseNextBlockTimestamp(10); // 10s
        await (
            await positionManager_.submitOrder(
                WBTC,
                normalized(25),
                normalized(10000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        const orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s

        await expect(positionManager_.executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(
                await account1.getAddress(),
                WBTC,
                normalized(25),
                normalized(10000), // avg price
                0, // trading fee
                0
            );
        let tokenInfo = await perpTracker_.getTokenInfo(WBTC);
        let feeInfo = await perpTracker_.getFeeInfo(WBTC);
        expect(tokenInfo.lpNetValue).to.deep.eq("1000014749804873036800000");
        expect(tokenInfo.netOpenInterest).to.deep.eq(normalized(850000));
        expect(tokenInfo.skew).to.deep.eq(normalized(50000));
        expect(feeInfo.accLongFinancingFee).to.deep.eq(0);
        expect(feeInfo.accShortFinancingFee).to.deep.eq("49998905245700000");
        // check financing fee rate
        await increaseNextBlockTimestamp(1); // 1s

        await (await market_.updateInfoWithPrice(WBTC, [])).wait();

        tokenInfo = await perpTracker_.getTokenInfo(WBTC);
        feeInfo = await perpTracker_.getFeeInfo(WBTC);
        expect(tokenInfo.lpNetValue).to.deep.eq("1000014879865511676150000");
        expect(tokenInfo.netOpenInterest).to.deep.eq(normalized(850000));
        expect(tokenInfo.skew).to.deep.eq(normalized(50000));
        expect(feeInfo.accLongFinancingFee).to.deep.eq("202536053630000");
        expect(feeInfo.accShortFinancingFee).to.deep.eq("49998905245700000");
    });
    it("hard limit", async () => {
        const ethPosition = await perpTracker_.getNetPositionSize(WETH);
        const btcPosition = await perpTracker_.getNetPositionSize(WBTC);
        expect(ethPosition[0]).to.deep.eq(normalized(600));
        expect(ethPosition[1]).to.deep.eq(normalized(0));
        expect(btcPosition[0]).to.deep.eq(normalized(25));
        expect(btcPosition[1]).to.deep.eq(normalized(-20));

        // account2 trade -655 eth and revert
        positionManager_ = positionManager_.connect(account2);
        await (
            await positionManager_.submitOrder(
                WETH,
                normalized(-655),
                normalized(1000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        let orderId = (await positionManager_.orderCnt()).sub(1);
        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s
        await expect(
            positionManager_.executeOrder(orderId, [])
        ).to.be.revertedWith("PositionManager: open interest exceed hardlimit");

        // account1 trade 6 btc and revert
        positionManager_ = positionManager_.connect(account1);
        await (
            await positionManager_.submitOrder(
                WBTC,
                normalized(6),
                normalized(10000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        orderId = (await positionManager_.orderCnt()).sub(1);
        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s
        await expect(
            positionManager_.executeOrder(orderId, [])
        ).to.be.revertedWith("PositionManager: open interest exceed hardlimit");

        // decrease hard limit
        await (
            await marketSettings_.setIntVals(
                hre.ethers.utils.formatBytes32String("hardLimitThreshold"),
                normalized(0.8)
            )
        ).wait();

        // account2 trade -5 btc and success
        positionManager_ = positionManager_.connect(account2);
        await (
            await positionManager_.submitOrder(
                WBTC,
                normalized(-5),
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

        // account2 trade -1 btc and revert
        positionManager_ = positionManager_.connect(account2);
        await (
            await positionManager_.submitOrder(
                WBTC,
                normalized(-5),
                normalized(10000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        orderId = (await positionManager_.orderCnt()).sub(1);
        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s
        await expect(
            positionManager_.executeOrder(orderId, [])
        ).to.be.revertedWith("PositionManager: open interest exceed hardlimit");
    });
    it("cancel order", async () => {
        // trade eth long
        await (
            await positionManager_.submitOrder(
                WETH,
                normalized(600),
                normalized(1000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        const orderId = (await positionManager_.orderCnt()).sub(1);
        await (await positionManager_.cancelOrder(orderId)).wait();

        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s

        await expect(
            positionManager_.executeOrder(orderId, [])
        ).to.be.revertedWith("PositionManager: order is not pending");
    });
    it("withdraw margin", async () => {
        positionManager_ = positionManager_.connect(account2);
        const position = await perpTracker_.getPosition(
            await account2.getAddress(),
            WBTC
        );
        expect(position[0]).to.deep.eq(normalized(-25));

        await expect(
            positionManager_.withdrawMargin(normalized(990000))
        ).to.be.revertedWith("PositionManager: leverage ratio too large");

        // close most position
        positionManager_ = positionManager_.connect(account2);
        await (
            await positionManager_.submitOrder(
                WBTC,
                normalized(24.99999),
                normalized(10000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        let orderId = (await positionManager_.orderCnt()).sub(1);
        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s
        await (await positionManager_.executeOrder(orderId, [])).wait();

        let status = await market_.accountMarginStatus(
            await account2.getAddress()
        );
        expect(status.mtm).to.deep.eq("1001650000000000000");
        expect(status.currentMargin).to.deep.eq("999999000021895086000000");
        expect(status.positionNotional).to.deep.eq(normalized(0.1));

        // try withdraw
        await expect(
            positionManager_.withdrawMargin(normalized(999995))
        ).to.be.revertedWith("PositionManager: margin too low");

        await (
            await positionManager_.withdrawMargin(normalized(999949))
        ).wait();
        // close rest position
        positionManager_ = positionManager_.connect(account2);
        await (
            await positionManager_.submitOrder(
                WBTC,
                normalized(0.00001),
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

        status = await market_.accountMarginStatus(await account2.getAddress());
        expect(status.mtm).to.deep.eq(0);
        expect(status.currentMargin).to.deep.eq("50000021895086000000");
        expect(status.positionNotional).to.deep.eq(0);

        await (
            await positionManager_.withdrawMargin("50000021895086000000")
        ).wait();
    });
    it("set functions", async () => {
        positionManager_ = positionManager_.connect(deployer);
        await positionManager_.setMarket(ADDR0);
        expect(await positionManager_.market()).to.eq(ADDR0);
    });
});
