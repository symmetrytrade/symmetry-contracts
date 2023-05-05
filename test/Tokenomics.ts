import hre, { deployments } from "hardhat";
import { expect } from "chai";
import {
    ADDR0,
    CONTRACTS,
    MAX_UINT256,
    MINTER_ROLE,
    UNIT,
    getProxyContract,
    normalized,
} from "../src/utils/utils";
import {
    WEEK,
    getPythUpdateData,
    increaseNextBlockTimestamp,
    printValues,
    setupPrices,
    startOfWeek,
} from "../src/utils/test_utils";
import { ethers } from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { NetworkConfigs, getConfig } from "../src/config";
import BigNumber from "bignumber.js";

describe("tokenomics", () => {
    let account1: ethers.Signer;
    let account2: ethers.Signer;
    let deployer: ethers.Signer;
    let config: NetworkConfigs;
    let lpToken_: ethers.Contract;
    let liquidityGauge_: ethers.Contract;
    let votingEscrow_: ethers.Contract;
    let callbackRelayer_: ethers.Contract;
    let sym_: ethers.Contract;
    let maxTime: number;

    async function userVestBalanceAt(account: ethers.Signer, ts: number) {
        const n = (
            await votingEscrow_.userVestEpoch(await account.getAddress())
        ).toNumber();
        let ans = new BigNumber(0);
        for (let i = 1; i <= n; ++i) {
            const vest = await votingEscrow_.userVestHistory(
                await account1.getAddress(),
                i
            );
            if (vest.ts > ts) {
                ans = ans.plus(
                    new BigNumber(vest.amount.toString())
                        .dividedToIntegerBy(maxTime)
                        .multipliedBy(vest.ts - ts)
                );
            }
        }
        return ans;
    }

    before(async () => {
        deployer = (await hre.ethers.getSigners())[0];
        account1 = (await hre.ethers.getSigners())[1];
        account2 = (await hre.ethers.getSigners())[2];
        await deployments.fixture();
        callbackRelayer_ = await hre.ethers.getContract(
            CONTRACTS.VotingEscrowCallbackRelayer.name,
            deployer
        );
        lpToken_ = await hre.ethers.getContract(
            CONTRACTS.LPToken.name,
            deployer
        );
        sym_ = await hre.ethers.getContract(CONTRACTS.SYM.name, deployer);
        liquidityGauge_ = await getProxyContract(
            hre,
            CONTRACTS.LiquidityGauge,
            account1
        );
        votingEscrow_ = await getProxyContract(
            hre,
            CONTRACTS.VotingEscrow,
            account1
        );
        config = getConfig(hre.network.name);
        maxTime = config.otherConfig.lockMaxTime;

        // ad lp minter and transfer lp tokens to accounts
        await (
            await lpToken_.grantRole(MINTER_ROLE, await deployer.getAddress())
        ).wait();

        await (
            await lpToken_.mint(
                await account1.getAddress(),
                normalized(1000000)
            )
        ).wait();

        await (
            await lpToken_.mint(
                await account2.getAddress(),
                normalized(1000000)
            )
        ).wait();

        await (
            await lpToken_
                .connect(account1)
                .approve(liquidityGauge_.address, normalized(1000000))
        ).wait();

        await (
            await lpToken_
                .connect(account2)
                .approve(liquidityGauge_.address, normalized(1000000))
        ).wait();

        await (
            await sym_
                .connect(account1)
                .approve(votingEscrow_.address, normalized(1000000))
        ).wait();

        await (
            await sym_
                .connect(account2)
                .approve(votingEscrow_.address, normalized(1000000))
        ).wait();
    });

    it("deposit lp", async () => {
        // align the evm time to week
        const nextWeek = startOfWeek(await helpers.time.latest()) + WEEK;
        await helpers.time.setNextBlockTimestamp(nextWeek);
        await (
            await liquidityGauge_.connect(account1).deposit(normalized(1000))
        ).wait();
        expect(
            await lpToken_.balanceOf(await account1.getAddress())
        ).to.deep.eq(normalized(999000));
        expect(await lpToken_.balanceOf(liquidityGauge_.address)).to.deep.eq(
            normalized(1000)
        );

        const userInfo = await liquidityGauge_.userInfo(
            await account1.getAddress()
        );
        expect(userInfo.amount).to.deep.eq(normalized(1000));
        expect(userInfo.workingPower).to.deep.eq(normalized(330));
        expect(userInfo.rewardPerShare).to.deep.eq(normalized(0));
        expect(await liquidityGauge_.accRewardPerShare()).to.deep.eq(0);

        await increaseNextBlockTimestamp(330); // 330 seconds
        await (await liquidityGauge_.update()).wait();
        expect(await liquidityGauge_.accRewardPerShare()).to.deep.eq(
            normalized(1)
        );
    });
    it("withdraw 100 lp", async () => {
        await increaseNextBlockTimestamp(990); // 330 seconds
        let evmTime = (await helpers.time.latest()) + 990;
        await expect(
            liquidityGauge_.connect(account1).withdraw(normalized(900))
        )
            .to.emit(votingEscrow_, "Vested")
            .withArgs(await account1.getAddress(), normalized(1320), evmTime);

        expect(
            await lpToken_.balanceOf(await account1.getAddress())
        ).to.deep.eq(normalized(999900));
        expect(await lpToken_.balanceOf(liquidityGauge_.address)).to.deep.eq(
            normalized(100)
        );
        const userInfo = await liquidityGauge_.userInfo(
            await account1.getAddress()
        );
        expect(userInfo.amount).to.deep.eq(normalized(100));
        expect(userInfo.workingPower).to.deep.eq(normalized(100));
        expect(userInfo.rewardPerShare).to.deep.eq(normalized(4));
        expect(await liquidityGauge_.accRewardPerShare()).to.deep.eq(
            normalized(4)
        );
        // check vesting
        expect(await sym_.balanceOf(votingEscrow_.address)).to.deep.eq(
            normalized(1320)
        );
        expect(
            await votingEscrow_.userVestEpoch(await account1.getAddress())
        ).to.deep.eq(12);
        let vest = await votingEscrow_.userVestHistory(
            await account1.getAddress(),
            0
        );
        expect(vest.amount).to.deep.eq(0);
        expect(vest.ts).to.deep.eq(0);
        let totalSupply = new BigNumber(0);
        let ts = startOfWeek(await helpers.time.latest());
        for (let i = 1; i <= 12; ++i) {
            ts += WEEK;
            vest = await votingEscrow_.userVestHistory(
                await account1.getAddress(),
                i
            );
            expect(vest.amount).to.deep.eq(normalized(110));
            expect(vest.ts).to.deep.eq(ts);
            totalSupply = totalSupply.plus(
                new BigNumber(normalized(110))
                    .dividedToIntegerBy(maxTime)
                    .multipliedBy(vest.ts - (await helpers.time.latest()))
            );
        }
        expect(await votingEscrow_.totalSupply()).to.deep.eq(totalSupply);
        expect(
            await votingEscrow_.userPointEpoch(await account1.getAddress())
        ).to.deep.eq(1);
        expect(
            await votingEscrow_.balanceOf(await account1.getAddress())
        ).to.deep.eq(totalSupply);
        expect(
            await votingEscrow_.balanceOfAt(
                await account1.getAddress(),
                (await helpers.time.latest()) - 1
            )
        ).to.deep.eq(0);
        expect(
            await votingEscrow_.balanceOfAt(
                await account1.getAddress(),
                await helpers.time.latest()
            )
        ).to.deep.eq(totalSupply);
        // three weeks later
        await increaseNextBlockTimestamp(WEEK * 3); // 3 weeks
        evmTime = (await helpers.time.latest()) + WEEK * 3;
        await expect(votingEscrow_.connect(account1).claimVested())
            .to.emit(votingEscrow_, "Claimed")
            .withArgs(await account1.getAddress(), normalized(330), evmTime);
        expect(await sym_.balanceOf(votingEscrow_.address)).to.deep.eq(
            normalized(990)
        );
        expect(await sym_.balanceOf(await account1.getAddress())).to.deep.eq(
            normalized(330)
        );
        totalSupply = await userVestBalanceAt(
            account1,
            await helpers.time.latest()
        );
        expect(await votingEscrow_.totalSupply()).to.deep.eq(
            totalSupply.toString(10)
        );
        expect(
            await votingEscrow_.balanceOf(await account1.getAddress())
        ).to.deep.eq(totalSupply.toString(10));
        expect(
            await votingEscrow_.balanceOfAt(
                await account1.getAddress(),
                (await helpers.time.latest()) - WEEK
            )
        ).to.deep.eq(
            (
                await userVestBalanceAt(
                    account1,
                    (await helpers.time.latest()) - WEEK
                )
            ).toString(10)
        );
        expect(
            await votingEscrow_.totalSupplyAt(
                (await helpers.time.latest()) - WEEK
            )
        ).to.deep.eq(
            (
                await userVestBalanceAt(
                    account1,
                    (await helpers.time.latest()) - WEEK
                )
            ).toString(10)
        );
    });
    it("callback handler", async () => {
        let handles = await callbackRelayer_.getCallbackHandles();
        expect(handles.length).to.deep.eq(1);
        await increaseNextBlockTimestamp(WEEK * 1); // 3 weeks since last tx to votingEscrow
        await (
            await callbackRelayer_.removeCallbackHandle(liquidityGauge_.address)
        ).wait();
        handles = await callbackRelayer_.getCallbackHandles();
        expect(handles.length).to.deep.eq(0);
        await increaseNextBlockTimestamp(WEEK * 1); // 3 weeks since last tx to votingEscrow
        await (
            await callbackRelayer_.addCallbackHandle(liquidityGauge_.address)
        ).wait();
        handles = await callbackRelayer_.getCallbackHandles();
        expect(handles.length).to.deep.eq(1);
    });
    it("lock SYM, trigger callback and vest", async () => {
        await increaseNextBlockTimestamp(WEEK * 1); // 3 weeks since last tx to votingEscrow
        const lockEnd = startOfWeek(await helpers.time.latest()) + 2 * WEEK;
        const evmTime = (await helpers.time.latest()) + 1 * WEEK;
        expect(
            await votingEscrow_
                .connect(account1)
                .createLock(normalized(100), lockEnd, 0, false)
        )
            .to.emit(votingEscrow_, "Deposit")
            .withArgs(
                await account1.getAddress(),
                normalized(100),
                lockEnd,
                0,
                false,
                0
            )
            .to.emit(votingEscrow_, "Vested")
            .withArgs(
                await account1.getAddress(),
                normalized(3628800), // 6 * weeks * 1 sym/sec
                evmTime
            )
            .to.emit(liquidityGauge_, "UpdateWorkingPower")
            .withArgs(await account1.getAddress(), normalized(100))
            .to.emit(votingEscrow_, "Claimed")
            .withArgs(await account1.getAddress(), normalized(330), evmTime);
        // check balances
        expect(await sym_.balanceOf(await account1.getAddress())).to.deep.eq(
            normalized(330 + 330 - 100)
        );
        const n = (
            await votingEscrow_.userVestEpoch(await account1.getAddress())
        ).toNumber();
        expect(n).to.deep.eq(18);
        for (let i = 1; i <= n; ++i) {
            const vest = await votingEscrow_.userVestHistory(
                await account1.getAddress(),
                i
            );
            if (vest.ts >= (await helpers.time.latest())) {
                if (i <= 12) {
                    expect(vest.amount).to.deep.eq(normalized(302400 + 110));
                } else {
                    expect(vest.amount).to.deep.eq(normalized(302400));
                }
            } else {
                expect(vest.amount).to.deep.eq(normalized(110));
            }
        }
        let veBalance = await userVestBalanceAt(
            account1,
            await helpers.time.latest()
        );
        //console.log(veBalance.toString(10));
        veBalance = veBalance.plus(
            new BigNumber(normalized(100))
                .dividedToIntegerBy(maxTime)
                .multipliedBy(lockEnd - (await helpers.time.latest()))
        );
        expect(veBalance.toString(10)).to.deep.eq(
            await votingEscrow_.totalSupply()
        );
        expect(veBalance.toString(10)).to.deep.eq(
            await votingEscrow_.balanceOf(await account1.getAddress())
        );
        expect(
            await votingEscrow_.balanceOfAt(
                await account1.getAddress(),
                (await helpers.time.latest()) + 100
            )
        ).to.deep.eq(
            (
                await userVestBalanceAt(
                    account1,
                    (await helpers.time.latest()) + 100
                )
            )
                .plus(
                    new BigNumber(normalized(100))
                        .dividedToIntegerBy(maxTime)
                        .multipliedBy(
                            lockEnd - (await helpers.time.latest()) - 100
                        )
                )
                .toString(10)
        );
    });
    it("stake SYM, trigger callback and vest", async () => {
        await increaseNextBlockTimestamp(WEEK * 3); // 3 weeks
        const evmTime = (await helpers.time.latest()) + 3 * WEEK;
        const balance2 = (
            await userVestBalanceAt(account1, evmTime - 2 * WEEK)
        ).toString(10);
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
            .withArgs(await account1.getAddress(), normalized(100))
            .to.emit(votingEscrow_, "Claimed")
            .withArgs(
                await account1.getAddress(),
                normalized((302400 + 110) * 3),
                evmTime
            );
        expect(await votingEscrow_.totalSupply()).to.deep.eq(
            (await userVestBalanceAt(account1, evmTime)).toString(10)
        );
        expect(
            await votingEscrow_.totalSupplyAt(evmTime - 2 * WEEK)
        ).to.deep.eq(balance2);
        expect(
            await votingEscrow_.balanceOfAt(
                await account1.getAddress(),
                evmTime - 2 * WEEK
            )
        ).to.deep.eq(balance2);
        // check stake point
        expect(
            await votingEscrow_.userStakedEpoch(await account1.getAddress())
        ).to.deep.eq(1);
        expect(
            await votingEscrow_.staked(await account1.getAddress())
        ).to.deep.eq(normalized(100));
        const stakePoint = await votingEscrow_.userStakedHistory(
            await account1.getAddress(),
            1
        );
        expect(stakePoint.bias).to.deep.eq(0);
        expect(stakePoint.slope).to.deep.eq(
            new BigNumber(normalized(100)).dividedToIntegerBy(-maxTime)
        );
        expect(stakePoint.ts).to.deep.eq(evmTime);
        expect(stakePoint.end).to.deep.eq(startOfWeek(evmTime + maxTime));
        // 3 weeks later
        await increaseNextBlockTimestamp(WEEK * 3); // 3 weeks
        await (await votingEscrow_.connect(account1).claimVested()).wait();
        expect(await votingEscrow_.totalSupply()).to.deep.eq(
            (await userVestBalanceAt(account1, await helpers.time.latest()))
                .plus(
                    new BigNumber(normalized(100))
                        .dividedToIntegerBy(maxTime)
                        .multipliedBy(WEEK * 3)
                )
                .toString(10)
        );
        expect(
            await votingEscrow_.balanceOf(await account1.getAddress())
        ).to.deep.eq(
            (await userVestBalanceAt(account1, await helpers.time.latest()))
                .plus(
                    new BigNumber(normalized(100))
                        .dividedToIntegerBy(maxTime)
                        .multipliedBy(WEEK * 3)
                )
                .toString(10)
        );
    });
    it("12 weeks later, stake more", async () => {
        await increaseNextBlockTimestamp(WEEK * 12); // 12 weeks
        const evmTime = (await helpers.time.latest()) + WEEK * 12;
        await (
            await votingEscrow_.connect(account1).stake(normalized(100))
        ).wait();
        // check stake point
        expect(
            await votingEscrow_.userStakedEpoch(await account1.getAddress())
        ).to.deep.eq(2);
        expect(
            await votingEscrow_.staked(await account1.getAddress())
        ).to.deep.eq(normalized(200));
        const stakePoint = await votingEscrow_.userStakedHistory(
            await account1.getAddress(),
            2
        );
        let veGot = new BigNumber(normalized(100))
            .dividedToIntegerBy(maxTime)
            .multipliedBy(WEEK * 15)
            .toString(10);
        expect(stakePoint.bias).to.deep.eq(veGot);
        expect(stakePoint.slope).to.deep.eq(
            new BigNumber(normalized(200)).dividedToIntegerBy(-maxTime)
        );
        expect(stakePoint.ts).to.deep.eq(evmTime);
        const expectEnd = startOfWeek(
            evmTime +
                new BigNumber(normalized(200))
                    .minus(veGot)
                    .times(maxTime)
                    .dividedToIntegerBy(normalized(200))
                    .toNumber()
        );
        expect(stakePoint.end).to.deep.eq(expectEnd);
        // check balance
        expect(await votingEscrow_.totalSupply()).to.deep.eq(
            (await userVestBalanceAt(account1, await helpers.time.latest()))
                .plus(veGot)
                .toString(10)
        );
        expect(
            await votingEscrow_.balanceOf(await account1.getAddress())
        ).to.deep.eq(
            (await userVestBalanceAt(account1, await helpers.time.latest()))
                .plus(veGot)
                .toString(10)
        );
        // 3 weeks later
        await increaseNextBlockTimestamp(WEEK * 3); // 12 weeks
        await (await votingEscrow_.connect(account1).claimVested()).wait();
        veGot = new BigNumber(veGot)
            .plus(
                new BigNumber(normalized(200))
                    .dividedToIntegerBy(maxTime)
                    .multipliedBy(WEEK * 3)
            )
            .toString(10);
        expect(await votingEscrow_.totalSupply()).to.deep.eq(
            (await userVestBalanceAt(account1, await helpers.time.latest()))
                .plus(veGot)
                .toString(10)
        );
        expect(
            await votingEscrow_.balanceOf(await account1.getAddress())
        ).to.deep.eq(
            (await userVestBalanceAt(account1, await helpers.time.latest()))
                .plus(veGot)
                .toString(10)
        );
        const time2 = (await helpers.time.latest()) + 1000;
        const balance2 = (await userVestBalanceAt(account1, time2))
            .plus(
                new BigNumber(veGot).plus(
                    new BigNumber(normalized(200))
                        .dividedToIntegerBy(maxTime)
                        .multipliedBy(1000)
                )
            )
            .toString(10);
        // till maximum
        await helpers.time.setNextBlockTimestamp(expectEnd + 10000);
        veGot = new BigNumber(veGot)
            .plus(
                new BigNumber(normalized(200))
                    .dividedToIntegerBy(maxTime)
                    .multipliedBy(expectEnd - (await helpers.time.latest()))
            )
            .toString(10);
        await (await votingEscrow_.connect(account1).claimVested()).wait();
        expect(await votingEscrow_.totalSupply()).to.deep.eq(
            (await userVestBalanceAt(account1, await helpers.time.latest()))
                .plus(veGot)
                .toString(10)
        );
        expect(
            await votingEscrow_.balanceOf(await account1.getAddress())
        ).to.deep.eq(
            (await userVestBalanceAt(account1, await helpers.time.latest()))
                .plus(veGot)
                .toString(10)
        );
        expect(await votingEscrow_.totalSupplyAt(time2)).to.deep.eq(balance2);
        expect(
            await votingEscrow_.balanceOfAt(await account1.getAddress(), time2)
        ).to.deep.eq(balance2);
    });
    it("unstake", async () => {
        await increaseNextBlockTimestamp(WEEK); // 1 week
        const evmTime = (await helpers.time.latest()) + WEEK;
        await expect(votingEscrow_.connect(account1).unstake(normalized(100)))
            .to.emit(votingEscrow_, "Unstake")
            .withArgs(await account1.getAddress(), normalized(100), evmTime);
        expect(await votingEscrow_.totalSupply()).to.deep.eq(
            (
                await userVestBalanceAt(account1, await helpers.time.latest())
            ).toString(10)
        );
        expect(await votingEscrow_.balanceOf(account1.getAddress())).to.deep.eq(
            (
                await userVestBalanceAt(account1, await helpers.time.latest())
            ).toString(10)
        );
        await increaseNextBlockTimestamp(WEEK); // 1 week
        await (await votingEscrow_.connect(account1).claimVested()).wait();
        const veGot = new BigNumber(normalized(100))
            .dividedToIntegerBy(maxTime)
            .multipliedBy(WEEK);
        expect(await votingEscrow_.totalSupply()).to.deep.eq(
            (await userVestBalanceAt(account1, await helpers.time.latest()))
                .plus(veGot)
                .toString(10)
        );
        expect(
            await votingEscrow_.balanceOf(await account1.getAddress())
        ).to.deep.eq(
            (await userVestBalanceAt(account1, await helpers.time.latest()))
                .plus(veGot)
                .toString(10)
        );
    });
    it("stake, increase, withdraw", async () => {
        await (
            await sym_
                .connect(account1)
                .transfer(await account2.getAddress(), normalized(1000))
        ).wait();

        const n = await votingEscrow_.userStakedEpoch(
            await account1.getAddress()
        );
        expect(n).to.deep.eq(3);
        const stakePoint = await votingEscrow_.userStakedHistory(
            await account1.getAddress(),
            n
        );
        const veStake = new BigNumber(normalized(100))
            .dividedToIntegerBy(maxTime)
            .multipliedBy(stakePoint.end - stakePoint.ts);

        await increaseNextBlockTimestamp(maxTime); // max time
        // create lock (auto extend)
        await (
            await votingEscrow_
                .connect(account2)
                .createLock(normalized(100), 0, 1000, true)
        ).wait();

        let veLock = new BigNumber(normalized(100))
            .dividedToIntegerBy(maxTime)
            .multipliedBy(1000);

        expect(await votingEscrow_.totalSupply()).to.deep.eq(
            veLock.plus(veStake).toString(10)
        );
        expect(
            await votingEscrow_.balanceOf(await account1.getAddress())
        ).to.deep.eq(veStake.toString(10));
        expect(
            await votingEscrow_.balanceOf(await account2.getAddress())
        ).to.deep.eq(veLock.toString(10));

        expect(
            await votingEscrow_.totalSupplyAt(
                (await helpers.time.latest()) + 10000
            )
        ).to.deep.eq(veLock.plus(veStake).toString(10));
        expect(
            await votingEscrow_.balanceOfAt(
                await account1.getAddress(),
                (await helpers.time.latest()) + 10000
            )
        ).to.deep.eq(veStake.toString(10));
        expect(
            await votingEscrow_.balanceOfAt(
                await account2.getAddress(),
                (await helpers.time.latest()) + 10000
            )
        ).to.deep.eq(veLock.toString(10));
        // increase amount
        await (
            await votingEscrow_
                .connect(account2)
                .increaseLockAmount(normalized(100))
        ).wait();
        veLock = veLock.times(2);
        expect(await votingEscrow_.totalSupply()).to.deep.eq(
            veLock.plus(veStake).toString(10)
        );
        expect(
            await votingEscrow_.balanceOf(await account1.getAddress())
        ).to.deep.eq(veStake.toString(10));
        expect(
            await votingEscrow_.balanceOf(await account2.getAddress())
        ).to.deep.eq(veLock.toString(10));

        // extend unlock duration
        await (
            await votingEscrow_
                .connect(account2)
                .increaseUnlockTime(0, 2000, true)
        ).wait();
        veLock = veLock.times(2);
        expect(await votingEscrow_.totalSupply()).to.deep.eq(
            veLock.plus(veStake).toString(10)
        );
        expect(
            await votingEscrow_.balanceOf(await account1.getAddress())
        ).to.deep.eq(veStake.toString(10));
        expect(
            await votingEscrow_.balanceOf(await account2.getAddress())
        ).to.deep.eq(veLock.toString(10));

        // extend & increase
        await (
            await votingEscrow_
                .connect(account2)
                .increaseLockAmountAndUnlockTime(normalized(200), 0, 4000, true)
        ).wait();
        veLock = veLock.times(4);
        expect(await votingEscrow_.totalSupply()).to.deep.eq(
            veLock.plus(veStake).toString(10)
        );
        expect(
            await votingEscrow_.balanceOf(await account1.getAddress())
        ).to.deep.eq(veStake.toString(10));
        expect(
            await votingEscrow_.balanceOf(await account2.getAddress())
        ).to.deep.eq(veLock.toString(10));

        // disable auto-extend
        await increaseNextBlockTimestamp(1);
        let evmTime = (await helpers.time.latest()) + 1;
        const lockEnd = startOfWeek(evmTime + 4000) + 2 * WEEK;
        await (
            await votingEscrow_
                .connect(account2)
                .increaseUnlockTime(lockEnd, 0, false)
        ).wait();
        veLock = new BigNumber(normalized(400))
            .dividedToIntegerBy(maxTime)
            .multipliedBy(lockEnd - evmTime);
        expect(await votingEscrow_.totalSupply()).to.deep.eq(
            veLock.plus(veStake).toString(10)
        );
        expect(
            await votingEscrow_.balanceOf(await account1.getAddress())
        ).to.deep.eq(veStake.toString(10));
        expect(
            await votingEscrow_.balanceOf(await account2.getAddress())
        ).to.deep.eq(veLock.toString(10));

        evmTime += 1000;
        veLock = new BigNumber(normalized(400))
            .dividedToIntegerBy(maxTime)
            .multipliedBy(lockEnd - evmTime);
        expect(await votingEscrow_.totalSupplyAt(evmTime)).to.deep.eq(
            veLock.plus(veStake).toString(10)
        );
        expect(
            await votingEscrow_.balanceOfAt(
                await account1.getAddress(),
                evmTime
            )
        ).to.deep.eq(veStake.toString(10));
        expect(
            await votingEscrow_.balanceOfAt(
                await account2.getAddress(),
                evmTime
            )
        ).to.deep.eq(veLock.toString(10));

        // withdraw
        await increaseNextBlockTimestamp(maxTime);
        await (await votingEscrow_.connect(account2).withdraw()).wait();
        veLock = new BigNumber(0);
        expect(await votingEscrow_.totalSupply()).to.deep.eq(
            veLock.plus(veStake).toString(10)
        );
        expect(
            await votingEscrow_.balanceOf(await account1.getAddress())
        ).to.deep.eq(veStake.toString(10));
        expect(
            await votingEscrow_.balanceOf(await account2.getAddress())
        ).to.deep.eq(veLock.toString(10));
    });
    it("sym burn", async () => {
        const ts0 = await sym_.totalSupply();
        await (await sym_.connect(account1).burn(normalized(100))).wait();
        const ts1 = await sym_.totalSupply();
        expect(ts0.sub(ts1)).to.deep.eq(normalized(100));
    });
});
