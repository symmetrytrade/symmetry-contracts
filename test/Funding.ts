import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { encodeBytes32String, Signer, ZeroHash } from "ethers";
import hre, { deployments } from "hardhat";
import { getConfig, NetworkConfigs } from "../src/config";
import { DAY, increaseNextBlockTimestamp, setPythAutoRefresh, setupPrices } from "../src/utils/test_utils";
import { CONTRACTS, getTypedContract, MAX_UINT256, normalized, usdcOf } from "../src/utils/utils";
import {
    FaucetToken,
    LiquidityManager,
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

describe("Funding", () => {
    let account1: Signer;
    let account2: Signer;
    let config: NetworkConfigs;
    let market_: Market;
    let perpTracker_: PerpTracker;
    let positionManager_: PositionManager;
    let liquidityManager_: LiquidityManager;
    let marketSettings_: MarketSettings;
    let WETH_: FaucetToken;
    let USDC_: FaucetToken;

    before(async () => {
        account1 = (await hre.ethers.getSigners())[1];
        account2 = (await hre.ethers.getSigners())[2];
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH_ = await getTypedContract(hre, CONTRACTS.WETH);
        USDC_ = await getTypedContract(hre, CONTRACTS.USDC);
        market_ = await getTypedContract(hre, CONTRACTS.Market, account1);
        perpTracker_ = await getTypedContract(hre, CONTRACTS.PerpTracker, account1);
        marketSettings_ = await getTypedContract(hre, CONTRACTS.MarketSettings);
        liquidityManager_ = await getTypedContract(hre, CONTRACTS.LiquidityManager, account1);
        positionManager_ = await getTypedContract(hre, CONTRACTS.PositionManager, account1);
        config = getConfig(hre.network.name);

        await USDC_.transfer(account1, usdcOf(100000000));
        await USDC_.transfer(account2, usdcOf(100000000));

        // add liquidity
        USDC_ = USDC_.connect(account1);
        await USDC_.approve(market_, MAX_UINT256);
        const amount = usdcOf(1000000); // 1M
        const minLp = normalized(100000);
        await liquidityManager_.addLiquidity(amount, minLp, account1, false);

        await USDC_.connect(account2).approve(market_, MAX_UINT256);

        await marketSettings_.setIntVals([encodeBytes32String("maxFundingVelocity")], [normalized("0.2")]);
        // set financing fee rate, trading fee to zero
        await marketSettings_.setIntVals([encodeBytes32String("maxFinancingFeeRate")], [0]);
        await marketSettings_.setIntVals([encodeBytes32String("perpTradingFee")], [0]);
        // for convenience of following test, set divergence to 200%
        await marketSettings_.setIntVals([encodeBytes32String("maxPriceDivergence")], [normalized(2)]);
        await marketSettings_.setIntVals([encodeBytes32String("pythMaxAge")], [normalized(10000)]);
        // set slippage to zero
        await marketSettings_.setIntVals([encodeBytes32String("liquidityRange")], [0]);
        // set veSYM incentive ratio to 10%
        await marketSettings_.setIntVals([encodeBytes32String("veSYMFeeIncentiveRatio")], [normalized("0.1")]);
        await setPythAutoRefresh(hre);
    });

    it("open ETH long, keep it for 1 day", async () => {
        positionManager_ = positionManager_.connect(account1);
        // deposit margins
        await positionManager_.depositMargin(USDC_, usdcOf(10000), ZeroHash);

        // open eth long, 50000 notional
        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(50),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await expect(positionManager_.executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(account1, WETH_, normalized(50), normalized(1000), normalized(0), normalized(0), orderId);

        expect(await perpTracker_.nextFundingVelocity(WETH_)).to.eq(normalized("0.01"));
        await increaseNextBlockTimestamp(DAY);
        await helpers.mine(1);
        expect(await perpTracker_.nextFundingVelocity(WETH_)).to.eq(normalized("0.01"));
        const fs = await perpTracker_.nextAccFunding(WETH_, normalized(1000));
        expect(fs[0]).to.eq(normalized("0.01"));
        expect(fs[1]).to.eq(normalized(5));
    });
    it("open ETH short, filp the skew", async () => {
        const evmTime = BigInt(await helpers.time.latest());
        await increaseNextBlockTimestamp(1);
        // open eth short, 100000 notional
        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(-100),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(1),
            expiry: evmTime + 2n * DAY,
            reduceOnly: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(DAY - 1n); // 2 days since long position opened

        await expect(positionManager_.executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(account1, WETH_, normalized(-100), normalized(1000), normalized(0), normalized(0), orderId);

        expect(await perpTracker_.nextFundingVelocity(WETH_)).to.eq("-9990009990009990");
        let fs = await perpTracker_.nextAccFunding(WETH_, normalized(1000));
        expect(fs[0]).to.eq(normalized("0.02"));
        expect(fs[1]).to.eq(normalized(20));

        await increaseNextBlockTimestamp(DAY);

        await helpers.mine(1);
        fs = await perpTracker_.nextAccFunding(WETH_, normalized(1000));
        expect(fs[0]).to.eq("19980019980020");

        await increaseNextBlockTimestamp(DAY);
        await helpers.mine(1);
        fs = await perpTracker_.nextAccFunding(WETH_, normalized(1000));
        expect(fs[0]).to.eq("-9980019980019979");
        expect(fs[1]).to.eq("25024980019980020000");
    });
});
