import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "ethers";
import hre, { deployments } from "hardhat";
import { getConfig, NetworkConfigs } from "../src/config";
import { increaseNextBlockTimestamp, setPythAutoRefresh, startOfWeek, WEEK } from "../src/utils/test_utils";
import { CONTRACTS, getTypedContract, MINTER_ROLE, normalized } from "../src/utils/utils";
import { LiquidityGauge, LPToken, SYM, VotingEscrow, VotingEscrowCallbackRelayer } from "../typechain-types";

describe("tokenomics", () => {
    let account1: ethers.Signer;
    let account2: ethers.Signer;
    let deployer: ethers.Signer;
    let config: NetworkConfigs;
    let lpToken_: LPToken;
    let liquidityGauge_: LiquidityGauge;
    let votingEscrow_: VotingEscrow;
    let callbackRelayer_: VotingEscrowCallbackRelayer;
    let sym_: SYM;
    let maxTime: bigint;

    async function userVestBalanceAt(account: ethers.Signer, ts: ethers.BigNumberish) {
        const n = await votingEscrow_.userVestEpoch(await account.getAddress());
        let ans = 0n;
        for (let i = 1n; i <= n; ++i) {
            const vest = await votingEscrow_.userVestHistory(await account1.getAddress(), i);
            if (vest.ts > BigInt(ts)) {
                ans += (vest.amount / maxTime) * (vest.ts - BigInt(ts));
            }
        }
        return ans;
    }

    before(async () => {
        deployer = (await hre.ethers.getSigners())[0];
        account1 = (await hre.ethers.getSigners())[1];
        account2 = (await hre.ethers.getSigners())[2];
        await deployments.fixture();
        callbackRelayer_ = await getTypedContract(hre, CONTRACTS.VotingEscrowCallbackRelayer);
        lpToken_ = await getTypedContract(hre, CONTRACTS.LPToken);
        sym_ = await getTypedContract(hre, CONTRACTS.SYM);
        liquidityGauge_ = await getTypedContract(hre, CONTRACTS.LiquidityGauge, account1);
        votingEscrow_ = await getTypedContract(hre, CONTRACTS.VotingEscrow, account1);
        config = getConfig(hre.network.name);
        maxTime = BigInt(config.otherConfig.lockMaxTime);

        // ad lp minter and transfer lp tokens to accounts
        await lpToken_.grantRole(MINTER_ROLE, await deployer.getAddress());

        await lpToken_.mint(await account1.getAddress(), normalized(1000000));

        await lpToken_.mint(await account2.getAddress(), normalized(1000000));

        await lpToken_.connect(account1).approve(await liquidityGauge_.getAddress(), normalized(1000000));

        await lpToken_.connect(account2).approve(await liquidityGauge_.getAddress(), normalized(1000000));

        await sym_.connect(account1).approve(await votingEscrow_.getAddress(), normalized(1000000));

        await sym_.connect(account2).approve(await votingEscrow_.getAddress(), normalized(1000000));

        await setPythAutoRefresh(hre);
    });

    it("deposit lp", async () => {
        // align the evm time to week
        const nextWeek = startOfWeek(await helpers.time.latest()) + WEEK;
        await helpers.time.setNextBlockTimestamp(nextWeek);
        await liquidityGauge_.connect(account1).deposit(normalized(1000));
        expect(await lpToken_.balanceOf(await account1.getAddress())).to.eq(normalized(999000));
        expect(await lpToken_.balanceOf(await liquidityGauge_.getAddress())).to.eq(normalized(1000));

        const userInfo = await liquidityGauge_.userInfo(await account1.getAddress());
        expect(userInfo.amount).to.eq(normalized(1000));
        expect(userInfo.workingPower).to.eq(normalized(330));
        expect(userInfo.rewardPerShare).to.eq(normalized(0));
        expect(await liquidityGauge_.accRewardPerShare()).to.eq(0);

        await increaseNextBlockTimestamp(330); // 330 seconds
        await liquidityGauge_.update();
        expect(await liquidityGauge_.accRewardPerShare()).to.eq(normalized(1));
    });
    it("withdraw 100 lp", async () => {
        await increaseNextBlockTimestamp(990); // 330 seconds
        let evmTime = BigInt(await helpers.time.latest()) + 990n;
        await expect(liquidityGauge_.connect(account1).withdraw(normalized(900)))
            .to.emit(votingEscrow_, "Vested")
            .withArgs(await account1.getAddress(), normalized(1320), evmTime);

        expect(await lpToken_.balanceOf(await account1.getAddress())).to.eq(normalized(999900));
        expect(await lpToken_.balanceOf(await liquidityGauge_.getAddress())).to.eq(normalized(100));
        const userInfo = await liquidityGauge_.userInfo(await account1.getAddress());
        expect(userInfo.amount).to.eq(normalized(100));
        expect(userInfo.workingPower).to.eq(normalized(100));
        expect(userInfo.rewardPerShare).to.eq(normalized(4));
        expect(await liquidityGauge_.accRewardPerShare()).to.eq(normalized(4));
        // check vesting
        expect(await sym_.balanceOf(await votingEscrow_.getAddress())).to.eq(normalized(1320));
        expect(await votingEscrow_.userVestEpoch(await account1.getAddress())).to.eq(12);
        let vest = await votingEscrow_.userVestHistory(await account1.getAddress(), 0);
        expect(vest.amount).to.eq(0);
        expect(vest.ts).to.eq(0);
        let totalSupply = 0n;
        let ts = startOfWeek(await helpers.time.latest()) + WEEK;
        for (let i = 1; i <= 12; ++i) {
            ts += WEEK;
            vest = await votingEscrow_.userVestHistory(await account1.getAddress(), i);
            expect(vest.amount).to.eq(normalized(110));
            expect(vest.ts).to.eq(ts);
            totalSupply += (normalized(110) / maxTime) * (vest.ts - BigInt(await helpers.time.latest()));
        }
        expect(await votingEscrow_.totalSupply()).to.eq(totalSupply);
        expect(await votingEscrow_.userPointEpoch(await account1.getAddress())).to.eq(1);
        expect(await votingEscrow_.balanceOf(await account1.getAddress())).to.eq(totalSupply);
        expect(await votingEscrow_.balanceOfAt(await account1.getAddress(), (await helpers.time.latest()) - 1)).to.eq(
            0
        );
        expect(await votingEscrow_.balanceOfAt(await account1.getAddress(), await helpers.time.latest())).to.eq(
            totalSupply
        );
        // four weeks later, 3 week vested
        await increaseNextBlockTimestamp(WEEK * 4n); // 4 weeks
        evmTime = BigInt(await helpers.time.latest()) + WEEK * 4n;
        await expect(votingEscrow_.connect(account1).claimVested(await account1.getAddress()))
            .to.emit(votingEscrow_, "Claimed")
            .withArgs(await account1.getAddress(), normalized(330), evmTime);
        expect(await sym_.balanceOf(await votingEscrow_.getAddress())).to.eq(normalized(990));
        expect(await sym_.balanceOf(await account1.getAddress())).to.eq(normalized(330));
        totalSupply = await userVestBalanceAt(account1, await helpers.time.latest());
        expect(await votingEscrow_.totalSupply()).to.eq(totalSupply);
        expect(await votingEscrow_.balanceOf(await account1.getAddress())).to.eq(totalSupply);
        expect(
            await votingEscrow_.balanceOfAt(await account1.getAddress(), BigInt(await helpers.time.latest()) - WEEK)
        ).to.eq(await userVestBalanceAt(account1, BigInt(await helpers.time.latest()) - WEEK));
        expect(await votingEscrow_.totalSupplyAt(BigInt(await helpers.time.latest()) - WEEK)).to.eq(
            await userVestBalanceAt(account1, BigInt(await helpers.time.latest()) - WEEK)
        );
    });
    it("callback handler", async () => {
        let handles = await callbackRelayer_.getCallbackHandles();
        expect(handles.length).to.eq(1);
        await increaseNextBlockTimestamp(WEEK * 1n);
        await callbackRelayer_.removeCallbackHandle(await liquidityGauge_.getAddress());
        handles = await callbackRelayer_.getCallbackHandles();
        expect(handles.length).to.eq(0);
        await increaseNextBlockTimestamp(WEEK * 1n);
        await callbackRelayer_.addCallbackHandle(await liquidityGauge_.getAddress());
        handles = await callbackRelayer_.getCallbackHandles();
        expect(handles.length).to.eq(1);
    });
    it("lock SYM, trigger callback and vest", async () => {
        await increaseNextBlockTimestamp(WEEK * 1n);
        const lockEnd = startOfWeek(await helpers.time.latest()) + 2n * WEEK;
        const evmTime = BigInt(await helpers.time.latest()) + 1n * WEEK;
        const vested = 86400 * 7 * 7;
        await expect(votingEscrow_.connect(account1).createLock(normalized(100), lockEnd, 0, false))
            .to.emit(votingEscrow_, "Deposit")
            .withArgs(await account1.getAddress(), normalized(100), lockEnd, 0, false, 0, evmTime)
            .to.emit(votingEscrow_, "Vested")
            .withArgs(
                await account1.getAddress(),
                normalized(vested), // 7 * weeks * 1 sym/sec
                evmTime
            )
            .to.emit(liquidityGauge_, "UpdateWorkingPower")
            .withArgs(await account1.getAddress(), normalized(100));
        // check balances
        expect(await sym_.balanceOf(await account1.getAddress())).to.eq(normalized(330 - 100));
        const n = await votingEscrow_.userVestEpoch(await account1.getAddress());
        expect(n).to.eq(19);
        const newVestPerWeek = vested / 12; // 352800
        for (let i = 1n; i <= n; ++i) {
            const vest = await votingEscrow_.userVestHistory(await account1.getAddress(), i);
            if (vest.ts >= BigInt(await helpers.time.latest()) + WEEK) {
                if (i <= 12) {
                    expect(vest.amount).to.eq(normalized(newVestPerWeek + 110));
                } else {
                    expect(vest.amount).to.eq(normalized(newVestPerWeek));
                }
            } else {
                expect(vest.amount).to.eq(normalized(110));
            }
        }
        let veBalance = await userVestBalanceAt(account1, await helpers.time.latest());
        //console.log(veBalance.toString(10));
        veBalance += (normalized(100) / maxTime) * (lockEnd - BigInt(await helpers.time.latest()));
        expect(veBalance).to.eq(await votingEscrow_.totalSupply());
        expect(veBalance).to.eq(await votingEscrow_.balanceOf(await account1.getAddress()));
        expect(await votingEscrow_.balanceOfAt(await account1.getAddress(), (await helpers.time.latest()) + 100)).to.eq(
            (await userVestBalanceAt(account1, (await helpers.time.latest()) + 100)) +
                (normalized(100) / maxTime) * (lockEnd - BigInt(await helpers.time.latest()) - 100n)
        );
    });
    it("stake SYM, trigger callback and vest", async () => {
        await increaseNextBlockTimestamp(WEEK * 3n); // 3 weeks
        const evmTime = BigInt(await helpers.time.latest()) + 3n * WEEK;
        const balance2 = await userVestBalanceAt(account1, evmTime - 2n * WEEK);
        await expect(votingEscrow_.connect(account1).stake(normalized(100)))
            .to.emit(votingEscrow_, "Stake")
            .withArgs(await account1.getAddress(), normalized(100), evmTime)
            .to.emit(votingEscrow_, "Vested")
            .withArgs(
                await account1.getAddress(),
                normalized(1814400), // 3 * weeks * 1 sym/sec
                evmTime
            )
            .to.emit(liquidityGauge_, "UpdateWorkingPower")
            .withArgs(await account1.getAddress(), normalized(100));
        expect(await votingEscrow_.totalSupply()).to.eq(await userVestBalanceAt(account1, evmTime));
        expect(await votingEscrow_.totalSupplyAt(evmTime - 2n * WEEK)).to.eq(balance2);
        expect(await votingEscrow_.balanceOfAt(await account1.getAddress(), evmTime - 2n * WEEK)).to.eq(balance2);
        // check stake point
        expect(await votingEscrow_.userStakedEpoch(await account1.getAddress())).to.eq(1);
        expect(await votingEscrow_.staked(await account1.getAddress())).to.eq(normalized(100));
        const stakePoint = await votingEscrow_.userStakedHistory(await account1.getAddress(), 1);
        expect(stakePoint.bias).to.eq(0);
        expect(stakePoint.slope).to.eq(normalized(100) / -maxTime);
        expect(stakePoint.ts).to.eq(evmTime);
        expect(stakePoint.end).to.eq(startOfWeek(evmTime + maxTime));
        // 3 weeks later
        await increaseNextBlockTimestamp(WEEK * 3n); // 3 weeks
        await votingEscrow_.connect(account1).claimVested(await account1.getAddress());
        expect(await votingEscrow_.totalSupply()).to.eq(
            (await userVestBalanceAt(account1, await helpers.time.latest())) + (normalized(100) / maxTime) * (WEEK * 3n)
        );
        expect(await votingEscrow_.balanceOf(await account1.getAddress())).to.eq(
            (await userVestBalanceAt(account1, await helpers.time.latest())) + (normalized(100) / maxTime) * (WEEK * 3n)
        );
    });
    it("12 weeks later, stake more", async () => {
        await increaseNextBlockTimestamp(WEEK * 12n); // 12 weeks
        const evmTime = BigInt(await helpers.time.latest()) + WEEK * 12n;
        await votingEscrow_.connect(account1).stake(normalized(100));
        // check stake point
        expect(await votingEscrow_.userStakedEpoch(await account1.getAddress())).to.eq(2);
        expect(await votingEscrow_.staked(await account1.getAddress())).to.eq(normalized(200));
        const stakePoint = await votingEscrow_.userStakedHistory(await account1.getAddress(), 2);
        let veGot = (normalized(100) / maxTime) * (WEEK * 15n);
        expect(stakePoint.bias).to.eq(veGot);
        expect(stakePoint.slope).to.eq(normalized(200) / -maxTime);
        expect(stakePoint.ts).to.eq(evmTime);
        const expectEnd = startOfWeek(evmTime + ((normalized(200) - veGot) * maxTime) / normalized(200));
        expect(stakePoint.end).to.eq(expectEnd);
        // check balance
        expect(await votingEscrow_.totalSupply()).to.eq(
            (await userVestBalanceAt(account1, await helpers.time.latest())) + veGot
        );
        expect(await votingEscrow_.balanceOf(await account1.getAddress())).to.eq(
            (await userVestBalanceAt(account1, await helpers.time.latest())) + veGot
        );
        // 3 weeks later
        await increaseNextBlockTimestamp(WEEK * 3n); // 12 weeks
        await votingEscrow_.connect(account1).claimVested(await account1.getAddress());
        veGot += (normalized(200) / maxTime) * (WEEK * 3n);
        expect(await votingEscrow_.totalSupply()).to.eq(
            (await userVestBalanceAt(account1, await helpers.time.latest())) + veGot
        );
        expect(await votingEscrow_.balanceOf(await account1.getAddress())).to.eq(
            (await userVestBalanceAt(account1, await helpers.time.latest())) + veGot
        );
        const time2 = (await helpers.time.latest()) + 1000;
        const balance2 = (await userVestBalanceAt(account1, time2)) + (veGot + (normalized(200) / maxTime) * 1000n);
        // till maximum
        await helpers.time.setNextBlockTimestamp(expectEnd + 10000n);
        veGot += (normalized(200) / maxTime) * (expectEnd - BigInt(await helpers.time.latest()));
        await votingEscrow_.connect(account1).claimVested(await account1.getAddress());
        expect(await votingEscrow_.totalSupply()).to.eq(
            (await userVestBalanceAt(account1, await helpers.time.latest())) + veGot
        );
        expect(await votingEscrow_.balanceOf(await account1.getAddress())).to.eq(
            (await userVestBalanceAt(account1, await helpers.time.latest())) + veGot
        );
        expect(await votingEscrow_.totalSupplyAt(time2)).to.eq(balance2);
        expect(await votingEscrow_.balanceOfAt(await account1.getAddress(), time2)).to.eq(balance2);
    });
    it("unstake", async () => {
        await increaseNextBlockTimestamp(WEEK); // 1 week
        const evmTime = BigInt(await helpers.time.latest()) + WEEK;
        await expect(votingEscrow_.connect(account1).unstake(normalized(100)))
            .to.emit(votingEscrow_, "Unstake")
            .withArgs(await account1.getAddress(), normalized(100), evmTime);
        expect(await votingEscrow_.totalSupply()).to.eq(await userVestBalanceAt(account1, await helpers.time.latest()));
        expect(await votingEscrow_.balanceOf(account1.getAddress())).to.eq(
            await userVestBalanceAt(account1, await helpers.time.latest())
        );
        await increaseNextBlockTimestamp(WEEK); // 1 week
        await votingEscrow_.connect(account1).claimVested(await account1.getAddress());
        const veGot = (normalized(100) / maxTime) * WEEK;
        expect(await votingEscrow_.totalSupply()).to.eq(
            (await userVestBalanceAt(account1, await helpers.time.latest())) + veGot
        );
        expect(await votingEscrow_.balanceOf(await account1.getAddress())).to.eq(
            (await userVestBalanceAt(account1, await helpers.time.latest())) + veGot
        );
    });
    it("stake, increase, withdraw", async () => {
        await sym_.connect(account1).transfer(await account2.getAddress(), normalized(1000));

        const n = await votingEscrow_.userStakedEpoch(await account1.getAddress());
        expect(n).to.eq(3);
        const stakePoint = await votingEscrow_.userStakedHistory(await account1.getAddress(), n);
        const veStake = (normalized(100) / maxTime) * (stakePoint.end - stakePoint.ts);

        await increaseNextBlockTimestamp(maxTime); // max time
        // create lock (auto extend)
        await votingEscrow_.connect(account2).createLock(normalized(100), 0, 1000, true);

        let veLock = (normalized(100) / maxTime) * 1000n;

        expect(await votingEscrow_.totalSupply()).to.eq(veLock + veStake);
        expect(await votingEscrow_.balanceOf(await account1.getAddress())).to.eq(veStake);
        expect(await votingEscrow_.balanceOf(await account2.getAddress())).to.eq(veLock);

        expect(await votingEscrow_.totalSupplyAt((await helpers.time.latest()) + 10000)).to.eq(veLock + veStake);
        expect(
            await votingEscrow_.balanceOfAt(await account1.getAddress(), (await helpers.time.latest()) + 10000)
        ).to.eq(veStake);
        expect(
            await votingEscrow_.balanceOfAt(await account2.getAddress(), (await helpers.time.latest()) + 10000)
        ).to.eq(veLock);
        // increase amount
        await votingEscrow_.connect(account2).increaseLockAmount(normalized(100));
        veLock *= 2n;
        expect(await votingEscrow_.totalSupply()).to.eq(veLock + veStake);
        expect(await votingEscrow_.balanceOf(await account1.getAddress())).to.eq(veStake);
        expect(await votingEscrow_.balanceOf(await account2.getAddress())).to.eq(veLock);

        // extend unlock duration
        await votingEscrow_.connect(account2).increaseUnlockTime(0, 2000, true);
        veLock *= 2n;
        expect(await votingEscrow_.totalSupply()).to.eq(veLock + veStake);
        expect(await votingEscrow_.balanceOf(await account1.getAddress())).to.eq(veStake);
        expect(await votingEscrow_.balanceOf(await account2.getAddress())).to.eq(veLock);

        // extend & increase
        await votingEscrow_.connect(account2).increaseLockAmountAndUnlockTime(normalized(200), 0, 4000, true);
        veLock *= 4n;
        expect(await votingEscrow_.totalSupply()).to.eq(veLock + veStake);
        expect(await votingEscrow_.balanceOf(await account1.getAddress())).to.eq(veStake);
        expect(await votingEscrow_.balanceOf(await account2.getAddress())).to.eq(veLock);

        // disable auto-extend
        await increaseNextBlockTimestamp(1);
        let evmTime = BigInt(await helpers.time.latest()) + 1n;
        const lockEnd = startOfWeek(evmTime + 4000n) + 2n * WEEK;
        await votingEscrow_.connect(account2).increaseUnlockTime(lockEnd, 0, false);
        veLock = (normalized(400) / maxTime) * (lockEnd - evmTime);
        expect(await votingEscrow_.totalSupply()).to.eq(veLock + veStake);
        expect(await votingEscrow_.balanceOf(await account1.getAddress())).to.eq(veStake);
        expect(await votingEscrow_.balanceOf(await account2.getAddress())).to.eq(veLock);

        evmTime += 1000n;
        veLock = (normalized(400) / maxTime) * (lockEnd - evmTime);
        expect(await votingEscrow_.totalSupplyAt(evmTime)).to.eq(veLock + veStake);
        expect(await votingEscrow_.balanceOfAt(await account1.getAddress(), evmTime)).to.eq(veStake);
        expect(await votingEscrow_.balanceOfAt(await account2.getAddress(), evmTime)).to.eq(veLock);

        // withdraw
        await increaseNextBlockTimestamp(maxTime);
        await votingEscrow_.connect(account2).withdraw();
        veLock = 0n;
        expect(await votingEscrow_.totalSupply()).to.eq(veLock + veStake);
        expect(await votingEscrow_.balanceOf(await account1.getAddress())).to.eq(veStake);
        expect(await votingEscrow_.balanceOf(await account2.getAddress())).to.eq(veLock);
    });
    it("sym burn", async () => {
        const ts0 = await sym_.totalSupply();
        await sym_.connect(account1).burn(normalized(100));
        const ts1 = await sym_.totalSupply();
        expect(ts0 - ts1).to.eq(normalized(100));
    });
});
