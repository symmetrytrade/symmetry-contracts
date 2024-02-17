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
    let account1: ethers.Signer;
    let account2: ethers.Signer;
    let account3: ethers.Signer;
    let deployer: ethers.Signer;
    let config: NetworkConfigs;
    let market_: Market;
    let perpTracker_: PerpTracker;
    let positionManager_: PositionManager;
    let liquidityManager_: LiquidityManager;
    let marginTracker_: MarginTracker;
    let marketSettings_: MarketSettings;
    let WETH: string;
    let WBTC: string;
    let USDC_: FaucetToken;

    async function checkOrders(account: string, ids: ethers.BigNumberish[]) {
        const orders = await positionManager_.getUserOrders(account, 0);
        expect(orders.length).to.deep.eq(ids.length);
        for (let i = 0; i < ids.length; ++i) {
            expect(orders[i].index).to.deep.eq(i);
            expect(orders[i].id).to.deep.eq(BigInt(ids[i]));
        }
    }

    before(async () => {
        deployer = (await hre.ethers.getSigners())[0];
        account1 = (await hre.ethers.getSigners())[1];
        account2 = (await hre.ethers.getSigners())[2];
        account3 = (await hre.ethers.getSigners())[3];
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH = await (await getTypedContract(hre, CONTRACTS.WETH)).getAddress();
        WBTC = await (await getTypedContract(hre, CONTRACTS.WBTC)).getAddress();
        USDC_ = await getTypedContract(hre, CONTRACTS.USDC);
        market_ = await getTypedContract(hre, CONTRACTS.Market, account1);
        perpTracker_ = await getTypedContract(hre, CONTRACTS.PerpTracker, account1);
        marginTracker_ = await getTypedContract(hre, CONTRACTS.MarginTracker, account1);
        marketSettings_ = await getTypedContract(hre, CONTRACTS.MarketSettings);
        liquidityManager_ = await getTypedContract(hre, CONTRACTS.LiquidityManager, account1);
        positionManager_ = await getTypedContract(hre, CONTRACTS.PositionManager, account1);
        config = getConfig(hre.network.name);

        await USDC_.transfer(await account1.getAddress(), usdcOf(100000000));
        await USDC_.transfer(await account2.getAddress(), usdcOf(100000000));
        await USDC_.transfer(await account3.getAddress(), usdcOf(100000000));

        // add liquidity
        USDC_ = USDC_.connect(account1);
        await USDC_.approve(await market_.getAddress(), MAX_UINT256);
        const amount = BigInt(usdcOf(1000000)); // 1M
        const minLp = 100000n * UNIT;
        await liquidityManager_.addLiquidity(amount, minLp, await account1.getAddress(), false);

        await USDC_.connect(account2).approve(await market_.getAddress(), MAX_UINT256);
        await USDC_.connect(account3).approve(await market_.getAddress(), MAX_UINT256);

        // set funding rate, fee and slippage to zero for convenience
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxFundingVelocity")], [0]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("liquidityRange")], [0]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("perpTradingFee")], [0]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("pythMaxAge")], [1000000]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("minKeeperFee")], [usdcOf(1)]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxPriceDivergence")], [normalized(10)]);
        // deposit margins
        await positionManager_.depositMargin(await USDC_.getAddress(), usdcOf(1000000), hre.ethers.ZeroHash);

        await positionManager_
            .connect(account2)
            .depositMargin(await USDC_.getAddress(), usdcOf(1000000), hre.ethers.ZeroHash);
        await positionManager_
            .connect(account3)
            .depositMargin(await USDC_.getAddress(), usdcOf(1000), hre.ethers.ZeroHash);
        await setPythAutoRefresh(hre);
    });
    it("lp limit for token & user order list", async () => {
        await positionManager_.submitOrder({
            token: WETH,
            size: normalized(701),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        expect(await positionManager_.pendingOrderNotional(await account1.getAddress())).to.deep.eq(normalized(701000));
        let orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        await checkOrders(await account1.getAddress(), [0]);

        await expect(positionManager_.connect(deployer).executeOrder(orderId, [])).to.be.revertedWith(
            "PositionManager: position size exceeds limit"
        );

        await positionManager_.submitOrder({
            token: WETH,
            size: normalized(-701),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        orderId = (await positionManager_.orderCnt()) - 1n;
        await checkOrders(await account1.getAddress(), [0, 1]);
        await positionManager_.submitOrder({
            token: WETH,
            size: normalized(-701),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        orderId = (await positionManager_.orderCnt()) - 1n;
        await checkOrders(await account1.getAddress(), [0, 1, 2]);

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await expect(positionManager_.connect(deployer).executeOrder(orderId, [])).to.be.revertedWith(
            "PositionManager: position size exceeds limit"
        );
        expect(await positionManager_.pendingOrderNotional(await account1.getAddress())).to.deep.eq(
            normalized(701000 * 3)
        );
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        const b0 = await marginTracker_.userCollaterals(await deployer.getAddress(), await USDC_.getAddress());
        await positionManager_.connect(deployer).cancelOrder(0);
        const b1 = await marginTracker_.userCollaterals(await deployer.getAddress(), await USDC_.getAddress());
        // keeper fee
        expect(b1 - b0).to.deep.eq(usdcOf(1));
        expect(await positionManager_.pendingOrderNotional(await account1.getAddress())).to.deep.eq(
            normalized(701000 * 2)
        );
        await checkOrders(await account1.getAddress(), [2, 1]);
        await positionManager_.connect(deployer).cancelOrder(1);
        await checkOrders(await account1.getAddress(), [2]);
        await positionManager_.connect(deployer).cancelOrder(2);
        await checkOrders(await account1.getAddress(), []);
        expect(await positionManager_.pendingOrderNotional(await account1.getAddress())).to.deep.eq(0);
    });
    it("account1 open eth long", async () => {
        // trade eth long
        await positionManager_.submitOrder({
            token: WETH,
            size: normalized(600),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await expect(positionManager_.connect(deployer).executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(
                await account1.getAddress(),
                WETH,
                normalized(600),
                normalized(1000), // avg price
                0, // trading fee
                0,
                orderId
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
        await market_.updateInfoWithPrice(WETH, []);

        tokenInfo = await perpTracker_.getTokenInfo(WETH);
        feeInfo = await perpTracker_.getFeeInfo(WETH);
        expect(tokenInfo.lpNetValue).to.deep.eq("1000000041666666666400000");
        expect(tokenInfo.netOpenInterest).to.deep.eq(normalized(600000));
        expect(tokenInfo.skew).to.deep.eq(normalized(600000));
        expect(feeInfo.accLongFinancingFee).to.deep.eq("69444444444000");
        expect(feeInfo.accShortFinancingFee).to.deep.eq(0);

        // check btc financing fee
        await increaseNextBlockTimestamp(1); // 1s
        await market_.updateInfoWithPrice(WBTC, []);

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
        await positionManager_.submitOrder({
            token: WBTC,
            size: normalized(-60),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
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
            token: WBTC,
            size: normalized(-20),
            acceptablePrice: normalized(10000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await expect(positionManager_.connect(deployer).executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(
                await account2.getAddress(),
                WBTC,
                normalized(-20),
                normalized(10000), // avg price
                0, // trading fee
                0,
                orderId
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
        await market_.updateInfoWithPrice(WBTC, []);

        tokenInfo = await perpTracker_.getTokenInfo(WBTC);
        feeInfo = await perpTracker_.getFeeInfo(WBTC);
        expect(tokenInfo.lpNetValue).to.deep.eq("1000005972220195218400000");
        expect(tokenInfo.netOpenInterest).to.deep.eq(normalized(800000));
        expect(tokenInfo.skew).to.deep.eq(normalized(-200000));
        expect(feeInfo.accLongFinancingFee).to.deep.eq(0);
        expect(feeInfo.accShortFinancingFee).to.deep.eq("694429379010000");

        // check eth financing fee
        await increaseNextBlockTimestamp(1); // 1s
        await market_.updateInfoWithPrice(WETH, []);

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
        await positionManager_.submitOrder({
            token: WBTC,
            size: normalized(25),
            acceptablePrice: normalized(10000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await expect(positionManager_.connect(deployer).executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(
                await account1.getAddress(),
                WBTC,
                normalized(25),
                normalized(10000), // avg price
                0, // trading fee
                0,
                orderId
            );
        let tokenInfo = await perpTracker_.getTokenInfo(WBTC);
        let feeInfo = await perpTracker_.getFeeInfo(WBTC);
        expect(tokenInfo.lpNetValue).to.deep.eq("1000015749782977950800000");
        expect(tokenInfo.netOpenInterest).to.deep.eq(normalized(850000));
        expect(tokenInfo.skew).to.deep.eq(normalized(50000));
        expect(feeInfo.accLongFinancingFee).to.deep.eq(0);
        expect(feeInfo.accShortFinancingFee).to.deep.eq("49998905245700000");
        // check financing fee rate
        await increaseNextBlockTimestamp(1); // 1s

        await market_.updateInfoWithPrice(WBTC, []);

        tokenInfo = await perpTracker_.getTokenInfo(WBTC);
        feeInfo = await perpTracker_.getFeeInfo(WBTC);
        expect(tokenInfo.lpNetValue).to.deep.eq("1000015879843599230400000");
        expect(tokenInfo.netOpenInterest).to.deep.eq(normalized(850000));
        expect(tokenInfo.skew).to.deep.eq(normalized(50000));
        expect(feeInfo.accLongFinancingFee).to.deep.eq("202535359240000");
        expect(feeInfo.accShortFinancingFee).to.deep.eq("49998905245700000");

        const lpPosition = await perpTracker_.getLpPosition(WBTC);
        expect(lpPosition.unsettled).to.deep.eq("999978104914000000");
    });
    it("hard limit", async () => {
        const ethPosition = await perpTracker_.getNetPositionSize(WETH);
        const btcPosition = await perpTracker_.getNetPositionSize(WBTC);
        expect(ethPosition[0]).to.deep.eq(normalized(600));
        expect(ethPosition[1]).to.deep.eq(normalized(0));
        expect(btcPosition[0]).to.deep.eq(normalized(25));
        expect(btcPosition[1]).to.deep.eq(normalized(-20));

        // account2 trade -655 eth and revert
        const to_cancel = [];
        positionManager_ = positionManager_.connect(account2);
        await positionManager_.submitOrder({
            token: WETH,
            size: normalized(-655),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
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
            token: WBTC,
            size: normalized(6),
            acceptablePrice: normalized(10000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        orderId = (await positionManager_.orderCnt()) - 1n;
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        await expect(positionManager_.connect(deployer).executeOrder(orderId, [])).to.be.revertedWith(
            "PositionManager: open interest exceed hardlimit"
        );
        to_cancel.push(orderId);

        // decrease hard limit
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("hardLimitThreshold")], [normalized(0.8)]);

        // account2 trade -5 btc and success
        positionManager_ = positionManager_.connect(account2);
        await positionManager_.submitOrder({
            token: WBTC,
            size: normalized(-5),
            acceptablePrice: normalized(10000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        orderId = (await positionManager_.orderCnt()) - 1n;
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        await positionManager_.connect(deployer).executeOrder(orderId, []);

        // account2 trade -1 btc and revert
        positionManager_ = positionManager_.connect(account2);
        await positionManager_.submitOrder({
            token: WBTC,
            size: normalized(-5),
            acceptablePrice: normalized(10000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
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
            token: WETH,
            size: normalized(600),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 300,
            reduceOnly: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;
        await expect(positionManager_.connect(deployer).cancelOrder(orderId)).to.be.revertedWith(
            "PositionManager: not expired"
        );
        const cur = await helpers.time.latest();
        await increaseNextBlockTimestamp(1); // 60s
        await positionManager_.submitCancelOrder(orderId);
        expect((await positionManager_.orders(orderId)).data.expiry).to.deep.eq(
            cur + 1 + config.marketGeneralConfig.minOrderDelay
        );

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay + 1); // 60s

        await positionManager_.submitCancelOrder(orderId);

        expect((await positionManager_.orders(orderId)).status).to.deep.eq(OrderStatus.Cancelled);

        await expect(positionManager_.connect(deployer).executeOrder(orderId, [])).to.be.revertedWith(
            "PositionManager: not pending"
        );
    });
    it("withdraw margin", async () => {
        positionManager_ = positionManager_.connect(account2);
        const position = await perpTracker_.getPosition(await account2.getAddress(), WBTC);
        expect(position[0]).to.deep.eq(normalized(-25));

        await expect(positionManager_.withdrawMargin(await USDC_.getAddress(), usdcOf(990000))).to.be.revertedWith(
            "PositionManager: leverage ratio too large"
        );

        // close most position
        positionManager_ = positionManager_.connect(account2);

        await positionManager_.submitOrder({
            token: WBTC,
            size: normalized(24.99),
            acceptablePrice: normalized(10000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        let orderId = (await positionManager_.orderCnt()) - 1n;
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        await positionManager_.connect(deployer).executeOrder(orderId, []);

        let status = await market_.accountMarginStatus(await account2.getAddress());
        expect(status.mtm).to.deep.eq("22650000000000000000");
        expect(status.currentMargin).to.deep.eq("999994000022000000000000");
        expect(status.positionNotional).to.deep.eq(normalized(100));

        // try withdraw
        await expect(positionManager_.withdrawMargin(await USDC_.getAddress(), usdcOf(999989))).to.be.revertedWith(
            "PositionManager: leverage ratio too large"
        );
        await positionManager_.withdrawMargin(await USDC_.getAddress(), usdcOf(999903));
        // close rest position
        positionManager_ = positionManager_.connect(account2);
        await positionManager_.submitOrder({
            token: WBTC,
            size: normalized(0.01),
            acceptablePrice: normalized(10000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        orderId = (await positionManager_.orderCnt()) - 1n;
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        await positionManager_.connect(deployer).executeOrder(orderId, []);

        status = await market_.accountMarginStatus(await account2.getAddress());
        expect(status.mtm).to.deep.eq(0);
        expect(status.currentMargin).to.deep.eq("90000022000000000000");
        expect(status.positionNotional).to.deep.eq(0);

        await positionManager_.withdrawMargin(await USDC_.getAddress(), "90000022");
    });
    it("account1 close wbtc position", async () => {
        positionManager_ = positionManager_.connect(account1);
        // trade btc short
        await increaseNextBlockTimestamp(10); // 10s
        await positionManager_.submitOrder({
            token: WBTC,
            size: normalized(-25),
            acceptablePrice: normalized(10000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: true,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await expect(positionManager_.connect(deployer).executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(
                await account1.getAddress(),
                WBTC,
                normalized(-25),
                normalized(10000), // avg price
                0, // trading fee
                0,
                orderId
            );
        const lpPosition = await perpTracker_.getLpPosition(WBTC);
        expect(lpPosition.unsettled).to.deep.eq(0);
    });
    it("submit order", async () => {
        await liquidityManager_.addLiquidity(usdcOf(1000000), 0, await account1.getAddress(), false);

        positionManager_ = positionManager_.connect(account3);

        await positionManager_.submitOrder({
            token: WETH,
            size: normalized(10),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        let orderId = (await positionManager_.orderCnt()) - 1n;
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        await positionManager_.connect(deployer).executeOrder(orderId, []);

        await expect(
            positionManager_.submitOrder({
                token: WETH,
                size: normalized(1),
                acceptablePrice: normalized(1000),
                keeperFee: usdcOf(1),
                expiry: (await helpers.time.latest()) + 100,
                reduceOnly: true,
            })
        ).to.be.revertedWith("PositionManager: invalid reduce only order");

        await positionManager_.submitOrder({
            token: WETH,
            size: normalized(-9),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: true,
        });
        orderId = (await positionManager_.orderCnt()) - 1n;
        const to_cancel = [];
        to_cancel.push(orderId);

        await expect(
            positionManager_.submitOrder({
                token: WETH,
                size: normalized(-9),
                acceptablePrice: normalized(1000),
                keeperFee: usdcOf(1),
                expiry: (await helpers.time.latest()) + 100,
                reduceOnly: true,
            })
        ).to.be.revertedWith("PositionManager: invalid reduce only order");

        await expect(
            positionManager_.submitOrder({
                token: WETH,
                size: normalized(15),
                acceptablePrice: normalized(1000),
                keeperFee: usdcOf(1),
                expiry: (await helpers.time.latest()) + 100,
                reduceOnly: false,
            })
        ).to.be.revertedWith("PositionManager: leverage ratio too large");

        for (const id of to_cancel) {
            await positionManager_.submitCancelOrder(id);
            await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay + 1); // 60s
            await positionManager_.connect(deployer).cancelOrder(id);
        }
        const status = await market_.accountMarginStatus(await account3.getAddress());
        expect(status.mtm).to.deep.eq(normalized(220));
        expect(status.currentMargin).to.deep.eq(normalized(998));
        expect(status.positionNotional).to.deep.eq(normalized(10000));
    });
    it("execution fail: leverage exceed", async () => {
        await positionManager_.submitOrder({
            token: WETH,
            size: normalized(10),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        const pythUpdateData = await getPythUpdateData(hre, { WETH: 960 });
        await positionManager_.connect(deployer).executeOrder(orderId, pythUpdateData.updateData, {
            value: pythUpdateData.fee,
        });
        const order = await positionManager_.orders(orderId);
        expect(order.status).to.deep.eq(OrderStatus.Failed);

        const status = await market_.accountMarginStatus(await account3.getAddress());
        expect(status.mtm).to.deep.eq(normalized(212));
        expect(status.currentMargin).to.deep.eq(normalized(597));
        expect(status.positionNotional).to.deep.eq(normalized(9600));
    });
    it("execution fail: liquidatable, reduce only", async () => {
        await positionManager_.submitOrder({
            token: WETH,
            size: normalized(-10),
            acceptablePrice: normalized(800),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: true,
        });
        const reduceOnlyId = (await positionManager_.orderCnt()) - 1n;
        let status = await market_.accountMarginStatus(await account3.getAddress());
        expect(status.mtm).to.deep.eq(normalized(212));
        expect(status.currentMargin).to.deep.eq(normalized(596));
        expect(status.positionNotional).to.deep.eq(normalized(9600));

        await positionManager_.submitOrder({
            token: WETH,
            size: normalized(1),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        const pythUpdateData = await getPythUpdateData(hre, { WETH: 910 });
        await positionManager_.connect(deployer).executeOrder(orderId, pythUpdateData.updateData, {
            value: pythUpdateData.fee,
        });
        let order = await positionManager_.orders(orderId);
        expect(order.status).to.deep.eq(OrderStatus.Failed);

        status = await market_.accountMarginStatus(await account3.getAddress());
        expect(status.mtm).to.deep.eq(normalized(202));
        expect(status.currentMargin).to.deep.eq(normalized(95));
        expect(status.positionNotional).to.deep.eq(normalized(9100));
        await checkOrders(await account3.getAddress(), [reduceOnlyId]);

        await positionManager_.liquidatePosition(await account3.getAddress(), WETH, []);
        status = await market_.accountMarginStatus(await account3.getAddress());
        expect(status.mtm).to.deep.eq(0);
        expect(status.currentMargin).to.deep.eq(normalized(95 - 9100 * 0.01));
        expect(status.positionNotional).to.deep.eq(0);

        await positionManager_.connect(deployer).executeOrder(reduceOnlyId, []);
        order = await positionManager_.orders(reduceOnlyId);
        expect(order.status).to.deep.eq(OrderStatus.Failed);

        status = await market_.accountMarginStatus(await account3.getAddress());
        expect(status.mtm).to.deep.eq(0);
        expect(status.currentMargin).to.deep.eq(normalized(95 - 9100 * 0.01));
        expect(status.positionNotional).to.deep.eq(0);
    });
});
