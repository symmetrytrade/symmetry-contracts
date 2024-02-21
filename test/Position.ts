import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { AddressLike, BigNumberish, encodeBytes32String, MaxUint256, Signer, ZeroHash } from "ethers";
import hre, { deployments } from "hardhat";
import { getConfig, NetworkConfigs } from "../src/config";
import {
    getPythUpdateData,
    increaseNextBlockTimestamp,
    setPythAutoRefresh,
    setupPrices,
} from "../src/utils/test_utils";
import { CONTRACTS, getTypedContract, normalized, UNIT, usdcOf } from "../src/utils/utils";
import {
    FaucetToken,
    LiquidityManager,
    MarginTracker,
    Market,
    MarketSettings,
    PerpTracker,
    PositionManager,
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

const OrderStatus = {
    None: 0,
    Pending: 1,
    Executed: 2,
    Failed: 3,
    Cancelled: 4,
};

describe("Position", () => {
    let account1: Signer;
    let account2: Signer;
    let account3: Signer;
    let account4: Signer;
    let deployer: Signer;
    let config: NetworkConfigs;
    let market_: Market;
    let perpTracker_: PerpTracker;
    let positionManager_: PositionManager;
    let liquidityManager_: LiquidityManager;
    let marginTracker_: MarginTracker;
    let marketSettings_: MarketSettings;
    let WETH_: FaucetToken;
    let WBTC_: FaucetToken;
    let USDC_: FaucetToken;

    async function checkOrders(account: AddressLike, ids: BigNumberish[]) {
        const orders = await positionManager_.getUserOrders(account, 0);
        expect(orders.length).to.eq(ids.length);
        for (let i = 0; i < ids.length; ++i) {
            expect(orders[i].index).to.eq(i);
            expect(orders[i].id).to.eq(BigInt(ids[i]));
        }
    }

    before(async () => {
        [deployer, account1, account2, account3, account4] = await hre.ethers.getSigners();
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH_ = await getTypedContract(hre, CONTRACTS.WETH);
        WBTC_ = await getTypedContract(hre, CONTRACTS.WBTC);
        USDC_ = await getTypedContract(hre, CONTRACTS.USDC);
        market_ = await getTypedContract(hre, CONTRACTS.Market, account1);
        perpTracker_ = await getTypedContract(hre, CONTRACTS.PerpTracker, account1);
        marginTracker_ = await getTypedContract(hre, CONTRACTS.MarginTracker, account1);
        marketSettings_ = await getTypedContract(hre, CONTRACTS.MarketSettings);
        liquidityManager_ = await getTypedContract(hre, CONTRACTS.LiquidityManager, account1);
        positionManager_ = await getTypedContract(hre, CONTRACTS.PositionManager, account1);
        config = getConfig(hre.network.name);

        await USDC_.transfer(account1, usdcOf(100000000));
        await USDC_.transfer(account2, usdcOf(100000000));
        await USDC_.transfer(account3, usdcOf(100000000));
        await USDC_.transfer(account4, usdcOf(100000000));

        // add liquidity
        USDC_ = USDC_.connect(account1);
        await USDC_.approve(market_, MaxUint256);
        const amount = usdcOf(1000000); // 1M
        const minLp = 100000n * UNIT;
        await liquidityManager_.addLiquidity(amount, minLp, account1, false);

        await USDC_.connect(account2).approve(market_, MaxUint256);
        await USDC_.connect(account3).approve(market_, MaxUint256);
        await USDC_.connect(account4).approve(market_, MaxUint256);

        // set funding rate, fee and slippage to zero for convenience
        await marketSettings_.setIntVals([encodeBytes32String("maxFundingVelocity")], [0]);
        await marketSettings_.setIntVals([encodeBytes32String("liquidityRange")], [0]);
        await marketSettings_.setIntVals([encodeBytes32String("perpMakerFee")], [0]);
        await marketSettings_.setIntVals([encodeBytes32String("perpTakerFee")], [0]);
        await marketSettings_.setIntVals([encodeBytes32String("pythMaxAge")], [1000000]);
        await marketSettings_.setIntVals([encodeBytes32String("minKeeperFee")], [usdcOf(1)]);
        await marketSettings_.setIntVals([encodeBytes32String("maxPriceDivergence")], [normalized(10)]);
        // deposit margins
        await positionManager_.depositMargin(USDC_, usdcOf(1000000), ZeroHash);

        await positionManager_.connect(account2).depositMargin(USDC_, usdcOf(1000000), ZeroHash);
        await positionManager_.connect(account3).depositMargin(USDC_, usdcOf(1000), ZeroHash);
        await positionManager_.connect(account4).depositMargin(USDC_, usdcOf(1000), ZeroHash);
        await setPythAutoRefresh(hre);
    });
    it("lp limit for token & user order list", async () => {
        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(701),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
            stopLoss: false,
        });
        expect(await positionManager_.pendingOrderNotional(account1)).to.eq(normalized(701000));
        let orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        await checkOrders(account1, [0]);

        await expect(positionManager_.connect(deployer).executeOrder(orderId, [])).to.be.revertedWith(
            "PositionManager: position size exceeds limit"
        );

        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(-701),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
            stopLoss: false,
        });
        orderId = (await positionManager_.orderCnt()) - 1n;
        await checkOrders(account1, [0, 1]);
        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(-701),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
            stopLoss: false,
        });
        orderId = (await positionManager_.orderCnt()) - 1n;
        await checkOrders(account1, [0, 1, 2]);

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await expect(positionManager_.connect(deployer).executeOrder(orderId, [])).to.be.revertedWith(
            "PositionManager: position size exceeds limit"
        );
        expect(await positionManager_.pendingOrderNotional(account1)).to.eq(normalized(701000 * 3));
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        const b0 = await marginTracker_.userCollaterals(deployer, USDC_);
        await positionManager_.connect(deployer).cancelOrder(0);
        const b1 = await marginTracker_.userCollaterals(deployer, USDC_);
        // keeper fee
        expect(b1 - b0).to.eq(usdcOf(1));
        expect(await positionManager_.pendingOrderNotional(account1)).to.eq(normalized(701000 * 2));
        await checkOrders(account1, [2, 1]);
        await positionManager_.connect(deployer).cancelOrder(1);
        await checkOrders(account1, [2]);
        await positionManager_.connect(deployer).cancelOrder(2);
        await checkOrders(account1, []);
        expect(await positionManager_.pendingOrderNotional(account1)).to.eq(0);
    });
    it("account1 open eth long", async () => {
        // trade eth long
        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(600),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
            stopLoss: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await expect(positionManager_.connect(deployer).executeOrder(orderId, [])).to.emit(market_, "Traded").withArgs(
            account1,
            WETH_,
            normalized(600),
            normalized(1000), // avg price
            0, // trading fee
            0,
            orderId
        );
        let tokenInfo = await perpTracker_.getTokenInfo(WETH_);
        let feeInfo = await perpTracker_.getFeeInfo(WETH_);
        expect(tokenInfo.lpNetValue).to.eq(normalized(1000000));
        expect(tokenInfo.netOpenInterest).to.eq(normalized(600000));
        expect(tokenInfo.skew).to.eq(normalized(600000));
        expect(feeInfo.accLongFinancingFee).to.eq(0);
        expect(feeInfo.accShortFinancingFee).to.eq(0);
        // check financing fee rate
        await increaseNextBlockTimestamp(1); // 1s
        await market_.updateInfoWithPrice(WETH_, []);

        tokenInfo = await perpTracker_.getTokenInfo(WETH_);
        feeInfo = await perpTracker_.getFeeInfo(WETH_);
        expect(tokenInfo.lpNetValue).to.eq("1000000041666666666400000");
        expect(tokenInfo.netOpenInterest).to.eq(normalized(600000));
        expect(tokenInfo.skew).to.eq(normalized(600000));
        expect(feeInfo.accLongFinancingFee).to.eq("69444444444000");
        expect(feeInfo.accShortFinancingFee).to.eq(0);

        // check btc financing fee
        await increaseNextBlockTimestamp(1); // 1s
        await market_.updateInfoWithPrice(WBTC_, []);

        tokenInfo = await perpTracker_.getTokenInfo(WBTC_);
        feeInfo = await perpTracker_.getFeeInfo(WBTC_);
        expect(tokenInfo.lpNetValue).to.eq("1000000083333321179800000");
        expect(tokenInfo.netOpenInterest).to.eq(normalized(600000));
        expect(tokenInfo.skew).to.eq(0);
        expect(feeInfo.accLongFinancingFee).to.eq(0);
        expect(feeInfo.accShortFinancingFee).to.eq(0);
    });

    it("exceed hard limit", async () => {
        // trade btc short but exceed hard limit
        await increaseNextBlockTimestamp(10); // 10s
        await positionManager_.submitOrder({
            token: WBTC_,
            size: normalized(-60),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
            stopLoss: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await expect(positionManager_.connect(deployer).executeOrder(orderId, [])).to.be.revertedWith(
            "PositionManager: open interest exceed hardlimit"
        );
    });
    it("account2 open btc short", async () => {
        positionManager_ = positionManager_.connect(account2);
        // trade btc short
        await increaseNextBlockTimestamp(10); // 10s
        await positionManager_.submitOrder({
            token: WBTC_,
            size: normalized(-20),
            acceptablePrice: normalized(10000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
            stopLoss: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await expect(positionManager_.connect(deployer).executeOrder(orderId, [])).to.emit(market_, "Traded").withArgs(
            account2,
            WBTC_,
            normalized(-20),
            normalized(10000), // avg price
            0, // trading fee
            0,
            orderId
        );
        let tokenInfo = await perpTracker_.getTokenInfo(WBTC_);
        let feeInfo = await perpTracker_.getFeeInfo(WBTC_);
        expect(tokenInfo.lpNetValue).to.eq("1000005916664953124800000");
        expect(tokenInfo.netOpenInterest).to.eq(normalized(800000));
        expect(tokenInfo.skew).to.eq(normalized(-200000));
        expect(feeInfo.accLongFinancingFee).to.eq(0);
        expect(feeInfo.accShortFinancingFee).to.eq(0);
        // check financing fee rate
        await increaseNextBlockTimestamp(1); // 1s
        await market_.updateInfoWithPrice(WBTC_, []);

        tokenInfo = await perpTracker_.getTokenInfo(WBTC_);
        feeInfo = await perpTracker_.getFeeInfo(WBTC_);
        expect(tokenInfo.lpNetValue).to.eq("1000005972220195218400000");
        expect(tokenInfo.netOpenInterest).to.eq(normalized(800000));
        expect(tokenInfo.skew).to.eq(normalized(-200000));
        expect(feeInfo.accLongFinancingFee).to.eq(0);
        expect(feeInfo.accShortFinancingFee).to.eq("694429379010000");

        // check eth financing fee
        await increaseNextBlockTimestamp(1); // 1s
        await market_.updateInfoWithPrice(WETH_, []);

        tokenInfo = await perpTracker_.getTokenInfo(WETH_);
        feeInfo = await perpTracker_.getFeeInfo(WETH_);
        expect(tokenInfo.lpNetValue).to.eq("1000006027775434483400000");
        expect(tokenInfo.netOpenInterest).to.eq(normalized(800000));
        expect(tokenInfo.skew).to.eq(normalized(600000));
        expect(feeInfo.accLongFinancingFee).to.eq("9999997103587000");
        expect(feeInfo.accShortFinancingFee).to.eq(0);
    });
    it("account1 open btc long", async () => {
        positionManager_ = positionManager_.connect(account1);
        // trade btc short
        await increaseNextBlockTimestamp(10); // 10s
        await positionManager_.submitOrder({
            token: WBTC_,
            size: normalized(25),
            acceptablePrice: normalized(10000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
            stopLoss: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await expect(positionManager_.connect(deployer).executeOrder(orderId, [])).to.emit(market_, "Traded").withArgs(
            account1,
            WBTC_,
            normalized(25),
            normalized(10000), // avg price
            0, // trading fee
            0,
            orderId
        );
        let tokenInfo = await perpTracker_.getTokenInfo(WBTC_);
        let feeInfo = await perpTracker_.getFeeInfo(WBTC_);
        expect(tokenInfo.lpNetValue).to.eq("1000015749782977950800000");
        expect(tokenInfo.netOpenInterest).to.eq(normalized(850000));
        expect(tokenInfo.skew).to.eq(normalized(50000));
        expect(feeInfo.accLongFinancingFee).to.eq(0);
        expect(feeInfo.accShortFinancingFee).to.eq("49998905245700000");
        // check financing fee rate
        await increaseNextBlockTimestamp(1); // 1s

        await market_.updateInfoWithPrice(WBTC_, []);

        tokenInfo = await perpTracker_.getTokenInfo(WBTC_);
        feeInfo = await perpTracker_.getFeeInfo(WBTC_);
        expect(tokenInfo.lpNetValue).to.eq("1000015879843599230400000");
        expect(tokenInfo.netOpenInterest).to.eq(normalized(850000));
        expect(tokenInfo.skew).to.eq(normalized(50000));
        expect(feeInfo.accLongFinancingFee).to.eq("202535359240000");
        expect(feeInfo.accShortFinancingFee).to.eq("49998905245700000");

        const lpPosition = await perpTracker_.getLpPosition(WBTC_);
        expect(lpPosition.unsettled).to.eq("999978104914000000");
    });
    it("hard limit", async () => {
        const ethPosition = await perpTracker_.getNetPositionSize(WETH_);
        const btcPosition = await perpTracker_.getNetPositionSize(WBTC_);
        expect(ethPosition[0]).to.eq(normalized(600));
        expect(ethPosition[1]).to.eq(normalized(0));
        expect(btcPosition[0]).to.eq(normalized(25));
        expect(btcPosition[1]).to.eq(normalized(-20));

        // account2 trade -655 eth and revert
        const to_cancel = [];
        positionManager_ = positionManager_.connect(account2);
        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(-655),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
            stopLoss: false,
        });
        let orderId = (await positionManager_.orderCnt()) - 1n;
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        await expect(positionManager_.connect(deployer).executeOrder(orderId, [])).to.be.revertedWith(
            "PositionManager: open interest exceed hardlimit"
        );
        to_cancel.push(orderId);

        // account1 trade 6 btc and revert
        positionManager_ = positionManager_.connect(account1);
        await positionManager_.submitOrder({
            token: WBTC_,
            size: normalized(6),
            acceptablePrice: normalized(10000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
            stopLoss: false,
        });
        orderId = (await positionManager_.orderCnt()) - 1n;
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        await expect(positionManager_.connect(deployer).executeOrder(orderId, [])).to.be.revertedWith(
            "PositionManager: open interest exceed hardlimit"
        );
        to_cancel.push(orderId);

        // decrease hard limit
        await marketSettings_.setIntVals([encodeBytes32String("hardLimitThreshold")], [normalized("0.8")]);

        // account2 trade -5 btc and success
        positionManager_ = positionManager_.connect(account2);
        await positionManager_.submitOrder({
            token: WBTC_,
            size: normalized(-5),
            acceptablePrice: normalized(10000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
            stopLoss: false,
        });
        orderId = (await positionManager_.orderCnt()) - 1n;
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        await positionManager_.connect(deployer).executeOrder(orderId, []);

        // account2 trade -1 btc and revert
        positionManager_ = positionManager_.connect(account2);
        await positionManager_.submitOrder({
            token: WBTC_,
            size: normalized(-5),
            acceptablePrice: normalized(10000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
            stopLoss: false,
        });
        orderId = (await positionManager_.orderCnt()) - 1n;
        to_cancel.push(orderId);
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        await expect(positionManager_.connect(deployer).executeOrder(orderId, [])).to.be.revertedWith(
            "PositionManager: open interest exceed hardlimit"
        );
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        for (const id of to_cancel) {
            await positionManager_.connect(deployer).cancelOrder(id);
        }
    });
    it("cancel order", async () => {
        // trade eth long
        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(600),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 300,
            reduceOnly: false,
            stopLoss: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;
        await expect(positionManager_.connect(deployer).cancelOrder(orderId)).to.be.revertedWith(
            "PositionManager: not expired"
        );
        const cur = await helpers.time.latest();
        await increaseNextBlockTimestamp(1); // 60s
        await positionManager_.submitCancelOrder(orderId);
        expect((await positionManager_.orders(orderId)).data.expiry).to.eq(
            cur + 1 + config.marketGeneralConfig.minOrderDelay
        );

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay + 1); // 60s

        await positionManager_.submitCancelOrder(orderId);

        expect((await positionManager_.orders(orderId)).status).to.eq(OrderStatus.Cancelled);

        await expect(positionManager_.connect(deployer).executeOrder(orderId, [])).to.be.revertedWith(
            "PositionManager: not pending"
        );
    });
    it("withdraw margin", async () => {
        positionManager_ = positionManager_.connect(account2);
        const position = await perpTracker_.getPosition(account2, WBTC_);
        expect(position[0]).to.eq(normalized(-25));

        await expect(positionManager_.withdrawMargin(USDC_, usdcOf(990000))).to.be.revertedWith(
            "PositionManager: leverage ratio too large"
        );

        // close most position
        positionManager_ = positionManager_.connect(account2);

        await positionManager_.submitOrder({
            token: WBTC_,
            size: normalized("24.99"),
            acceptablePrice: normalized(10000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
            stopLoss: false,
        });
        let orderId = (await positionManager_.orderCnt()) - 1n;
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        await positionManager_.connect(deployer).executeOrder(orderId, []);

        let status = await market_.accountMarginStatus(account2);
        expect(status.mtm).to.eq("22650000000000000000");
        expect(status.currentMargin).to.eq("999994000022000000000000");
        expect(status.positionNotional).to.eq(normalized(100));

        // try withdraw
        await expect(positionManager_.withdrawMargin(USDC_, usdcOf(999989))).to.be.revertedWith(
            "PositionManager: leverage ratio too large"
        );
        await positionManager_.withdrawMargin(USDC_, usdcOf(999903));
        // close rest position
        positionManager_ = positionManager_.connect(account2);
        await positionManager_.submitOrder({
            token: WBTC_,
            size: normalized("0.01"),
            acceptablePrice: normalized(10000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
            stopLoss: false,
        });
        orderId = (await positionManager_.orderCnt()) - 1n;
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        await positionManager_.connect(deployer).executeOrder(orderId, []);

        status = await market_.accountMarginStatus(account2);
        expect(status.mtm).to.eq(0);
        expect(status.currentMargin).to.eq("90000022000000000000");
        expect(status.positionNotional).to.eq(0);

        await positionManager_.withdrawMargin(USDC_, "90000022");
    });
    it("account1 close wbtc position", async () => {
        positionManager_ = positionManager_.connect(account1);
        // trade btc short
        await increaseNextBlockTimestamp(10); // 10s
        await positionManager_.submitOrder({
            token: WBTC_,
            size: normalized(-25),
            acceptablePrice: normalized(10000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: true,
            stopLoss: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await expect(positionManager_.connect(deployer).executeOrder(orderId, [])).to.emit(market_, "Traded").withArgs(
            account1,
            WBTC_,
            normalized(-25),
            normalized(10000), // avg price
            0, // trading fee
            0,
            orderId
        );
        const lpPosition = await perpTracker_.getLpPosition(WBTC_);
        expect(lpPosition.unsettled).to.eq(0);
    });
    it("submit order", async () => {
        await liquidityManager_.addLiquidity(usdcOf(1000000), 0, account1, false);

        positionManager_ = positionManager_.connect(account3);

        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(10),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
            stopLoss: false,
        });
        let orderId = (await positionManager_.orderCnt()) - 1n;
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        await positionManager_.connect(deployer).executeOrder(orderId, []);

        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(-9),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: true,
            stopLoss: false,
        });
        orderId = (await positionManager_.orderCnt()) - 1n;
        const to_cancel = [];
        to_cancel.push(orderId);

        await expect(
            positionManager_.submitOrder({
                token: WETH_,
                size: normalized(15),
                acceptablePrice: normalized(1000),
                keeperFee: usdcOf(1),
                expiry: (await helpers.time.latest()) + 100,
                reduceOnly: false,
                stopLoss: false,
            })
        ).to.be.revertedWith("PositionManager: leverage ratio too large");

        for (const id of to_cancel) {
            await positionManager_.submitCancelOrder(id);
            await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay + 1); // 60s
            await positionManager_.connect(deployer).cancelOrder(id);
        }
        const status = await market_.accountMarginStatus(account3);
        expect(status.mtm).to.eq(normalized(220));
        expect(status.currentMargin).to.eq(normalized(998));
        expect(status.positionNotional).to.eq(normalized(10000));
    });
    it("execution fail: leverage exceed", async () => {
        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(10),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
            stopLoss: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        const pythUpdateData = await getPythUpdateData(hre, { WETH: 960 });
        await positionManager_.connect(deployer).executeOrder(orderId, pythUpdateData.updateData, {
            value: pythUpdateData.fee,
        });
        const order = await positionManager_.orders(orderId);
        expect(order.status).to.eq(OrderStatus.Failed);

        const status = await market_.accountMarginStatus(account3);
        expect(status.mtm).to.eq(normalized(212));
        expect(status.currentMargin).to.eq(normalized(597));
        expect(status.positionNotional).to.eq(normalized(9600));
    });
    it("execution fail: liquidatable, reduce only", async () => {
        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(-10),
            acceptablePrice: normalized(800),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: true,
            stopLoss: false,
        });
        const reduceOnlyId = (await positionManager_.orderCnt()) - 1n;
        let status = await market_.accountMarginStatus(account3);
        expect(status.mtm).to.eq(normalized(212));
        expect(status.currentMargin).to.eq(normalized(596));
        expect(status.positionNotional).to.eq(normalized(9600));

        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(1),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
            stopLoss: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        const pythUpdateData = await getPythUpdateData(hre, { WETH: 910 });
        await positionManager_.connect(deployer).executeOrder(orderId, pythUpdateData.updateData, {
            value: pythUpdateData.fee,
        });
        let order = await positionManager_.orders(orderId);
        expect(order.status).to.eq(OrderStatus.Failed);

        status = await market_.accountMarginStatus(account3);
        expect(status.mtm).to.eq(normalized(202));
        expect(status.currentMargin).to.eq(normalized(95));
        expect(status.positionNotional).to.eq(normalized(9100));
        await checkOrders(account3, [reduceOnlyId]);

        await positionManager_.liquidatePosition(account3, WETH_, []);
        status = await market_.accountMarginStatus(account3);
        expect(status.mtm).to.eq(0);
        expect(status.currentMargin).to.eq(normalized(95 - 9100 * 0.01));
        expect(status.positionNotional).to.eq(0);

        await positionManager_.connect(deployer).executeOrder(reduceOnlyId, []);
        order = await positionManager_.orders(reduceOnlyId);
        expect(order.status).to.eq(OrderStatus.Failed);

        status = await market_.accountMarginStatus(account3);
        expect(status.mtm).to.eq(0);
        expect(status.currentMargin).to.eq(normalized(95 - 9100 * 0.01));
        expect(status.positionNotional).to.eq(0);
    });
    it("stop loss", async () => {
        positionManager_ = positionManager_.connect(account4);
        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(10),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
            stopLoss: false,
        });
        let orderId = (await positionManager_.orderCnt()) - 1n;
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        let pythUpdateData = await getPythUpdateData(hre, { WETH: 1000 });
        await positionManager_.connect(deployer).executeOrder(orderId, pythUpdateData.updateData, {
            value: pythUpdateData.fee,
        });

        let status = await market_.accountMarginStatus(account4);
        expect(status.mtm).to.eq(normalized(220));
        expect(status.currentMargin).to.eq(normalized(1000 - 1));
        expect(status.positionNotional).to.eq(normalized(10000));

        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(-10),
            acceptablePrice: normalized(980),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: true,
            stopLoss: true,
        });
        orderId = (await positionManager_.orderCnt()) - 1n;
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        pythUpdateData = await getPythUpdateData(hre, { WETH: 950 });
        await positionManager_.connect(deployer).executeOrder(orderId, pythUpdateData.updateData, {
            value: pythUpdateData.fee,
        });

        status = await market_.accountMarginStatus(account4);
        expect(status.mtm).to.eq(0);
        expect(status.currentMargin).to.eq(normalized(1000 - 500 - 2));
        expect(status.positionNotional).to.eq(0);
    });
});
