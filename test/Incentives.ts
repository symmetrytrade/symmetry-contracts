import hre, { deployments } from "hardhat";
import { expect } from "chai";
import { CONTRACTS, MAX_UINT256, MINTER_ROLE, getProxyContract, normalized, usdcOf } from "../src/utils/utils";
import {
    WEEK,
    increaseNextBlockTimestamp,
    setPythAutoRefresh,
    setupPrices,
    startOfWeek,
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

describe("Incentives", () => {
    let account1: ethers.Signer;
    let account2: ethers.Signer;
    let deployer: ethers.Signer;
    let config: NetworkConfigs;
    let market_: ethers.Contract;
    let positionManager_: ethers.Contract;
    let liquidityManager_: ethers.Contract;
    let liquidityGauge_: ethers.Contract;
    let lpToken_: ethers.Contract;
    let marketSettings_: ethers.Contract;
    let votingEscrow_: ethers.Contract;
    let sym_: ethers.Contract;
    let WETH: string;
    let USDC_: ethers.Contract;
    let feeTracker_: ethers.Contract;

    before(async () => {
        deployer = (await hre.ethers.getSigners())[0];
        account1 = (await hre.ethers.getSigners())[1];
        account2 = (await hre.ethers.getSigners())[2];
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH = (await hre.ethers.getContract("WETH")).address;
        USDC_ = await hre.ethers.getContract("USDC", deployer);
        market_ = await getProxyContract(hre, CONTRACTS.Market, account1);
        marketSettings_ = await getProxyContract(hre, CONTRACTS.MarketSettings, deployer);
        lpToken_ = await hre.ethers.getContract(CONTRACTS.LPToken.name, account1);
        liquidityManager_ = await getProxyContract(hre, CONTRACTS.LiquidityManager, account1);
        liquidityGauge_ = await getProxyContract(hre, CONTRACTS.LiquidityGauge, account1);
        positionManager_ = await getProxyContract(hre, CONTRACTS.PositionManager, account1);
        feeTracker_ = await getProxyContract(hre, CONTRACTS.FeeTracker, account1);
        votingEscrow_ = await getProxyContract(hre, CONTRACTS.VotingEscrow, account1);
        sym_ = await hre.ethers.getContract(CONTRACTS.SYM.name, deployer);
        config = getConfig(hre.network.name);

        await (await USDC_.transfer(await account1.getAddress(), usdcOf(1e11))).wait();
        await (await USDC_.transfer(await account2.getAddress(), usdcOf(1e11))).wait();

        // add liquidity
        USDC_ = USDC_.connect(account1);
        await (await USDC_.approve(market_.address, MAX_UINT256)).wait();
        await (await lpToken_.approve(liquidityGauge_.address, MAX_UINT256)).wait();

        await (await USDC_.connect(account2).approve(market_.address, MAX_UINT256)).wait();
        await (await USDC_.connect(deployer).approve(market_.address, MAX_UINT256)).wait();

        await (await liquidityManager_.addLiquidity(usdcOf(1e10), 0, await account1.getAddress(), false)).wait();

        // stake lp & vest
        await (await liquidityGauge_.connect(account1).deposit(normalized(1000))).wait();
        await increaseNextBlockTimestamp(60); // 60s
        await (await liquidityGauge_.connect(account1).withdraw(normalized(1000))).wait();

        // set financing&funding fee rate to zero
        await (await marketSettings_.setIntVals(hre.ethers.utils.formatBytes32String("maxFundingVelocity"), 0)).wait();
        await (await marketSettings_.setIntVals(hre.ethers.utils.formatBytes32String("maxFinancingFeeRate"), 0)).wait();
        // for convenience of following test, set divergence to 200%
        await (
            await marketSettings_.setIntVals(hre.ethers.utils.formatBytes32String("maxPriceDivergence"), normalized(2))
        ).wait();
        await (
            await marketSettings_.setIntVals(hre.ethers.utils.formatBytes32String("pythMaxAge"), normalized(10000))
        ).wait();
        // set slippage to zero
        await (await marketSettings_.setIntVals(hre.ethers.utils.formatBytes32String("maxSlippage"), 0)).wait();
        // set veSYM incentive ratio to 10%
        await (
            await marketSettings_.setIntVals(
                hre.ethers.utils.formatBytes32String("veSYMFeeIncentiveRatio"),
                normalized(0.1)
            )
        ).wait();
        // allocate sym
        const maxTime = config.otherConfig.lockMaxTime;
        await (await sym_.grantRole(MINTER_ROLE, await deployer.getAddress())).wait();
        await (await sym_.mint(await account1.getAddress(), normalized(100000))).wait();
        await (await sym_.mint(await account2.getAddress(), normalized(100000))).wait();
        await (await sym_.connect(account1).approve(votingEscrow_.address, normalized(100000))).wait();
        await (await sym_.connect(account2).approve(votingEscrow_.address, normalized(100000))).wait();

        await helpers.time.setNextBlockTimestamp(startOfWeek((await helpers.time.latest()) + WEEK));
        await (await votingEscrow_.connect(account1).createLock(normalized(1), 0, maxTime, true)).wait();
        await (await votingEscrow_.connect(account1).stake(normalized(1))).wait();
        await (await votingEscrow_.connect(account2).createLock(normalized(100), 0, maxTime, true)).wait();
        await (await votingEscrow_.connect(account2).stake(normalized(100))).wait();

        await helpers.time.setNextBlockTimestamp(startOfWeek((await helpers.time.latest()) + WEEK));

        await setPythAutoRefresh(hre);
    });

    async function trade() {
        await (
            await positionManager_.submitOrder([
                WETH,
                normalized(50),
                normalized(1001),
                usdcOf(1),
                (await helpers.time.latest()) + 100,
                false,
            ])
        ).wait();
        const orderId = (await positionManager_.orderCnt()).sub(1);
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

    async function getClaimable(account: string, from: number, to: number) {
        let toClaim = ethers.BigNumber.from(0);
        for (let curWeek = from; curWeek <= to; curWeek += WEEK) {
            const incentives = await feeTracker_.tradingFeeIncentives(curWeek);
            const totalSupply = await votingEscrow_.totalSupplyAt(curWeek);
            const balance1 = await votingEscrow_.balanceOfAt(account, curWeek);
            toClaim = toClaim.add(incentives.mul(balance1).div(totalSupply));
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
        await (
            await positionManager_.depositMargin(USDC_.address, usdcOf(1000000), hre.ethers.constants.HashZero)
        ).wait();
        await trade();
        const week1 = startOfWeek(await helpers.time.latest());
        await helpers.time.setNextBlockTimestamp(week1 + WEEK);
        await helpers.mine(1);
        const toClaim = await getClaimable(await account1.getAddress(), week1, week1);
        expect(await feeTracker_.callStatic.claimIncentives(await account1.getAddress())).to.deep.eq(toClaim);
        await (await feeTracker_.claimIncentives(await account1.getAddress())).wait();
        expect(await feeTracker_.claimedWeekCursor(await account1.getAddress())).to.deep.eq(week1 + WEEK);
        expect(await feeTracker_.incentiveWeekCursor()).to.deep.eq(week1 + 2 * WEEK);
    });
    it("week 2-60", async () => {
        /*=== week 2-60 ===*/
        const week2 = startOfWeek(await helpers.time.latest());
        let curWeek = week2;
        for (let i = 2; i <= 60; ++i) {
            await trade();
            if (i % 5 === 1) {
                await (await votingEscrow_.connect(account1).stake(normalized(1))).wait();
            }
            if (i % 5 === 0) {
                await (await votingEscrow_.connect(account1).increaseLockAmount(normalized(1))).wait();
            }
            await helpers.time.setNextBlockTimestamp(curWeek + WEEK);
            await helpers.mine(1);
            curWeek += WEEK;
        }
        // account1 claim week 2-22(inclusive)
        let toClaim = await getClaimable(await account1.getAddress(), week2, week2 + 20 * WEEK);
        expect(await feeTracker_.callStatic.claimIncentives(await account1.getAddress())).to.deep.eq(toClaim);
        await (await feeTracker_.claimIncentives(await account1.getAddress())).wait();
        expect(await feeTracker_.claimedWeekCursor(await account1.getAddress())).to.deep.eq(week2 + 21 * WEEK);
        expect(await feeTracker_.incentiveWeekCursor()).to.deep.eq(week2 + 21 * WEEK);
        // account1 claim week 23-42(inclusive)
        toClaim = await getClaimable(await account1.getAddress(), week2 + 21 * WEEK, week2 + 40 * WEEK);
        expect(await feeTracker_.callStatic.claimIncentives(await account1.getAddress())).to.deep.eq(toClaim);
        await (await feeTracker_.claimIncentives(await account1.getAddress())).wait();
        expect(await feeTracker_.claimedWeekCursor(await account1.getAddress())).to.deep.eq(week2 + 41 * WEEK);
        expect(await feeTracker_.incentiveWeekCursor()).to.deep.eq(week2 + 41 * WEEK);
        // account1 claim week 42-60(inclusive)
        toClaim = await getClaimable(await account1.getAddress(), week2 + 41 * WEEK, week2 + 58 * WEEK);
        expect(await feeTracker_.callStatic.claimIncentives(await account1.getAddress())).to.deep.eq(toClaim);
        await (await feeTracker_.claimIncentives(await account1.getAddress())).wait();
        expect(await feeTracker_.claimedWeekCursor(await account1.getAddress())).to.deep.eq(week2 + 59 * WEEK);
        expect(await feeTracker_.incentiveWeekCursor()).to.deep.eq(week2 + 60 * WEEK);
        // account2 claim week 1-50(inclusive)
        toClaim = await getClaimable(await account2.getAddress(), week2 - WEEK, week2 + 48 * WEEK);
        expect(await feeTracker_.callStatic.claimIncentives(await account2.getAddress())).to.deep.eq(toClaim);
        await (await feeTracker_.claimIncentives(await account2.getAddress())).wait();
        expect(await feeTracker_.claimedWeekCursor(await account2.getAddress())).to.deep.eq(week2 + 49 * WEEK);
        expect(await feeTracker_.incentiveWeekCursor()).to.deep.eq(week2 + 60 * WEEK);
        // account2 claim week 51-60(inclusive)
        toClaim = await getClaimable(await account2.getAddress(), week2 + 49 * WEEK, week2 + 58 * WEEK);
        expect(await feeTracker_.callStatic.claimIncentives(await account2.getAddress())).to.deep.eq(toClaim);
        await (await feeTracker_.claimIncentives(await account2.getAddress())).wait();
        expect(await feeTracker_.claimedWeekCursor(await account2.getAddress())).to.deep.eq(week2 + 59 * WEEK);
        expect(await feeTracker_.incentiveWeekCursor()).to.deep.eq(week2 + 60 * WEEK);
    });
});
