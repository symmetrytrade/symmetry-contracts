import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "ethers";
import hre, { deployments } from "hardhat";
import { getConfig, NetworkConfigs } from "../src/config";
import {
    increaseNextBlockTimestamp,
    setPythAutoRefresh,
    setupPrices,
    startOfWeek,
    WEEK,
} from "../src/utils/test_utils";
import { CONTRACTS, getTypedContract, MAX_UINT256, MINTER_ROLE, normalized, usdcOf } from "../src/utils/utils";
import {
    FaucetToken,
    FeeTracker,
    LiquidityGauge,
    LiquidityManager,
    LPToken,
    Market,
    MarketSettings,
    PositionManager,
    SYM,
    VotingEscrow,
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

describe("Incentives", () => {
    let account1: ethers.Signer;
    let account2: ethers.Signer;
    let deployer: ethers.Signer;
    let config: NetworkConfigs;
    let market_: Market;
    let positionManager_: PositionManager;
    let liquidityManager_: LiquidityManager;
    let liquidityGauge_: LiquidityGauge;
    let lpToken_: LPToken;
    let marketSettings_: MarketSettings;
    let votingEscrow_: VotingEscrow;
    let sym_: SYM;
    let WETH: string;
    let USDC_: FaucetToken;
    let feeTracker_: FeeTracker;

    before(async () => {
        deployer = (await hre.ethers.getSigners())[0];
        account1 = (await hre.ethers.getSigners())[1];
        account2 = (await hre.ethers.getSigners())[2];
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH = await (await getTypedContract(hre, CONTRACTS.WETH)).getAddress();
        USDC_ = await getTypedContract(hre, CONTRACTS.USDC);
        market_ = await getTypedContract(hre, CONTRACTS.Market, account1);
        marketSettings_ = await getTypedContract(hre, CONTRACTS.MarketSettings);
        lpToken_ = await getTypedContract(hre, CONTRACTS.LPToken, account1);
        liquidityManager_ = await getTypedContract(hre, CONTRACTS.LiquidityManager, account1);
        liquidityGauge_ = await getTypedContract(hre, CONTRACTS.LiquidityGauge, account1);
        positionManager_ = await getTypedContract(hre, CONTRACTS.PositionManager, account1);
        feeTracker_ = await getTypedContract(hre, CONTRACTS.FeeTracker, account1);
        votingEscrow_ = await getTypedContract(hre, CONTRACTS.VotingEscrow, account1);
        sym_ = await getTypedContract(hre, CONTRACTS.SYM);
        config = getConfig(hre.network.name);

        await USDC_.transfer(await account1.getAddress(), usdcOf(1e11));
        await USDC_.transfer(await account2.getAddress(), usdcOf(1e11));

        // add liquidity
        USDC_ = USDC_.connect(account1);
        await USDC_.approve(await market_.getAddress(), MAX_UINT256);
        await lpToken_.approve(await liquidityGauge_.getAddress(), MAX_UINT256);

        await USDC_.connect(account2).approve(await market_.getAddress(), MAX_UINT256);
        await USDC_.connect(deployer).approve(await market_.getAddress(), MAX_UINT256);

        await liquidityManager_.addLiquidity(usdcOf(1e10), 0, await account1.getAddress(), false);

        // stake lp & vest
        await liquidityGauge_.connect(account1).deposit(normalized(1000));
        await increaseNextBlockTimestamp(60); // 60s
        await liquidityGauge_.connect(account1).withdraw(normalized(1000));

        // set financing&funding fee rate to zero
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxFundingVelocity")], [0]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxFinancingFeeRate")], [0]);
        // for convenience of following test, set divergence to 200%
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxPriceDivergence")], [normalized(2)]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("pythMaxAge")], [normalized(10000)]);
        // set slippage to zero
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("liquidityRange")], [0]);
        // set veSYM incentive ratio to 10%
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("veSYMFeeIncentiveRatio")], [normalized(0.1)]);
        // allocate sym
        const maxTime = config.otherConfig.lockMaxTime;
        await sym_.grantRole(MINTER_ROLE, await deployer.getAddress());
        await sym_.mint(await account1.getAddress(), normalized(100000));
        await sym_.mint(await account2.getAddress(), normalized(100000));
        await sym_.connect(account1).approve(await votingEscrow_.getAddress(), normalized(100000));
        await sym_.connect(account2).approve(await votingEscrow_.getAddress(), normalized(100000));

        await helpers.time.setNextBlockTimestamp(startOfWeek(await helpers.time.latest()) + WEEK);
        await votingEscrow_.connect(account1).createLock(normalized(1), 0, maxTime, true);
        await votingEscrow_.connect(account1).stake(normalized(1));
        await votingEscrow_.connect(account2).createLock(normalized(100), 0, maxTime, true);
        await votingEscrow_.connect(account2).stake(normalized(100));

        await helpers.time.setNextBlockTimestamp(startOfWeek(await helpers.time.latest()) + WEEK);

        await setPythAutoRefresh(hre);
    });

    async function trade() {
        await positionManager_.submitOrder({
            token: WETH,
            size: normalized(50),
            acceptablePrice: normalized(1001),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;
        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s
        await expect(positionManager_.connect(deployer).executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(
                await deployer.getAddress(),
                WETH,
                normalized(50),
                normalized(1001),
                normalized(50),
                normalized(0),
                orderId
            );
    }

    async function getClaimable(account: string, from: bigint, to: bigint) {
        let toClaim = 0n;
        for (let curWeek = from; curWeek <= to; curWeek += WEEK) {
            const incentives = await feeTracker_.tradingFeeIncentives(curWeek);
            const totalSupply = await votingEscrow_.totalSupplyAt(curWeek);
            const balance1 = await votingEscrow_.balanceOfAt(account, curWeek);
            toClaim = toClaim + (incentives * balance1) / totalSupply;
            /*
            console.log(
                `# offchain week ${curWeek / 604800}, locked balance = ${await votingEscrow_.lockedBalanceOfAt(
                    account,
                    curWeek
                )}, staked balance = ${await votingEscrow_.stakedBalanceOfAt(
                    account,
                    curWeek
                )}, balance = ${balance1.toString()}, claimable = ${incentives
                    .mul(balance1)
                    .div(totalSupply)
                    .toString()}`
            );
            */
        }
        return toClaim;
    }

    it("week 1, claim 1 week", async () => {
        positionManager_ = positionManager_.connect(deployer);
        // deposit margins
        await positionManager_.depositMargin(await USDC_.getAddress(), usdcOf(1000000), hre.ethers.ZeroHash);
        await trade();
        const week1 = startOfWeek(await helpers.time.latest());
        await helpers.time.setNextBlockTimestamp(week1 + WEEK);
        await helpers.mine(1);
        const toClaim = await getClaimable(await account1.getAddress(), week1, week1);
        expect(await feeTracker_.claimIncentives.staticCall(await account1.getAddress())).to.eq(toClaim);
        await feeTracker_.claimIncentives(await account1.getAddress());
        expect(await feeTracker_.claimedWeekCursor(await account1.getAddress())).to.eq(week1 + WEEK);
        expect(await feeTracker_.incentiveWeekCursor()).to.eq(week1 + 2n * WEEK);
    });
    it("week 2-60", async () => {
        /*=== week 2-60 ===*/
        const week2 = startOfWeek(await helpers.time.latest());
        let curWeek = week2;
        for (let i = 2; i <= 60; ++i) {
            await trade();
            if (i % 5 === 1) {
                await votingEscrow_.connect(account1).stake(normalized(1));
            }
            if (i % 5 === 0) {
                await votingEscrow_.connect(account1).increaseLockAmount(normalized(1));
            }
            await helpers.time.setNextBlockTimestamp(curWeek + WEEK);
            await helpers.mine(1);
            curWeek += WEEK;
        }
        // account1 claim week 2-22(inclusive)
        let toClaim = await getClaimable(await account1.getAddress(), week2, week2 + 20n * WEEK);
        expect(await feeTracker_.claimIncentives.staticCall(await account1.getAddress())).to.eq(toClaim);
        await feeTracker_.claimIncentives(await account1.getAddress());
        expect(await feeTracker_.claimedWeekCursor(await account1.getAddress())).to.eq(week2 + 21n * WEEK);
        expect(await feeTracker_.incentiveWeekCursor()).to.eq(week2 + 21n * WEEK);
        // account1 claim week 23-42(inclusive)
        toClaim = await getClaimable(await account1.getAddress(), week2 + 21n * WEEK, week2 + 40n * WEEK);
        expect(await feeTracker_.claimIncentives.staticCall(await account1.getAddress())).to.eq(toClaim);
        await feeTracker_.claimIncentives(await account1.getAddress());
        expect(await feeTracker_.claimedWeekCursor(await account1.getAddress())).to.eq(week2 + 41n * WEEK);
        expect(await feeTracker_.incentiveWeekCursor()).to.eq(week2 + 41n * WEEK);
        // account1 claim week 42-60(inclusive)
        toClaim = await getClaimable(await account1.getAddress(), week2 + 41n * WEEK, week2 + 58n * WEEK);
        expect(await feeTracker_.claimIncentives.staticCall(await account1.getAddress())).to.eq(toClaim);
        await feeTracker_.claimIncentives(await account1.getAddress());
        expect(await feeTracker_.claimedWeekCursor(await account1.getAddress())).to.eq(week2 + 59n * WEEK);
        expect(await feeTracker_.incentiveWeekCursor()).to.eq(week2 + 60n * WEEK);
        // account2 claim week 1-50(inclusive)
        toClaim = await getClaimable(await account2.getAddress(), week2 - WEEK, week2 + 48n * WEEK);
        expect(await feeTracker_.claimIncentives.staticCall(await account2.getAddress())).to.eq(toClaim);
        await feeTracker_.claimIncentives(await account2.getAddress());
        expect(await feeTracker_.claimedWeekCursor(await account2.getAddress())).to.eq(week2 + 49n * WEEK);
        expect(await feeTracker_.incentiveWeekCursor()).to.eq(week2 + 60n * WEEK);
        // account2 claim week 51-60(inclusive)
        toClaim = await getClaimable(await account2.getAddress(), week2 + 49n * WEEK, week2 + 58n * WEEK);
        expect(await feeTracker_.claimIncentives.staticCall(await account2.getAddress())).to.eq(toClaim);
        await feeTracker_.claimIncentives(await account2.getAddress());
        expect(await feeTracker_.claimedWeekCursor(await account2.getAddress())).to.eq(week2 + 59n * WEEK);
        expect(await feeTracker_.incentiveWeekCursor()).to.eq(week2 + 60n * WEEK);
    });
});
