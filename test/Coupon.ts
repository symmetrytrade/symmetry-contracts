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
    DAY,
    WEEK,
    getPythUpdateData,
    increaseNextBlockTimestamp,
    setupPrices,
    startOfDay,
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

describe("Coupon", () => {
    let account1: ethers.Signer;
    let account2: ethers.Signer;
    let deployer: ethers.Signer;
    let config: NetworkConfigs;
    let market_: ethers.Contract;
    let priceOracle_: ethers.Contract;
    let positionManager_: ethers.Contract;
    let liquidityManager_: ethers.Contract;
    let marketSettings_: ethers.Contract;
    let volumeTracker_: ethers.Contract;
    let votingEscrow_: ethers.Contract;
    let coupon_: ethers.Contract;
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
        volumeTracker_ = await getProxyContract(
            hre,
            CONTRACTS.VolumeTracker,
            account1
        );
        votingEscrow_ = await getProxyContract(
            hre,
            CONTRACTS.VotingEscrow,
            account1
        );
        coupon_ = await hre.ethers.getContract(
            CONTRACTS.TradingFeeCoupon.name,
            account1
        );
        sym_ = await hre.ethers.getContract(CONTRACTS.SYM.name, deployer);
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

        // set financing&funding fee rate to zero
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
        // for convenience of following test, set divergence to 200%
        await (
            await marketSettings_.setIntVals(
                hre.ethers.utils.formatBytes32String("maxPriceDivergence"),
                normalized(2)
            )
        ).wait();
        await (
            await marketSettings_.setIntVals(
                hre.ethers.utils.formatBytes32String("pythMaxAge"),
                normalized(10000)
            )
        ).wait();
        // set slippage to zero
        await (
            await marketSettings_.setIntVals(
                hre.ethers.utils.formatBytes32String("maxSlippage"),
                0
            )
        ).wait();
        // set veSYM incentive ratio to 10%
        await (
            await marketSettings_.setIntVals(
                hre.ethers.utils.formatBytes32String("veSYMFeeIncentiveRatio"),
                normalized(0.1)
            )
        ).wait();
        // set liquidation coupon ratio to 10%
        await (
            await marketSettings_.setIntVals(
                hre.ethers.utils.formatBytes32String("liquidationPenaltyRatio"),
                normalized(0.009)
            )
        ).wait();
        await (
            await marketSettings_.setIntVals(
                hre.ethers.utils.formatBytes32String("liquidationCouponRatio"),
                normalized(0.001)
            )
        ).wait();
        // allocate sym
        const maxTime = config.otherConfig.lockMaxTime;
        await (
            await sym_.grantRole(MINTER_ROLE, await deployer.getAddress())
        ).wait();
        await (
            await sym_.mint(await account1.getAddress(), normalized(2))
        ).wait();
        await (
            await sym_.mint(await account2.getAddress(), normalized(998))
        ).wait();
        await (
            await sym_
                .connect(account1)
                .approve(votingEscrow_.address, normalized(2))
        ).wait();
        await (
            await votingEscrow_
                .connect(account1)
                .createLock(normalized(2), 0, maxTime, true)
        ).wait();
        await (
            await sym_
                .connect(account2)
                .approve(votingEscrow_.address, normalized(998))
        ).wait();
        await (
            await votingEscrow_
                .connect(account2)
                .createLock(normalized(998), 0, maxTime, true)
        ).wait();

        await helpers.time.setNextBlockTimestamp(
            startOfWeek((await helpers.time.latest()) + maxTime)
        );
    });

    it("trade with tiered trading fee discount", async () => {
        positionManager_ = positionManager_.connect(account1);
        // deposit margins
        await (
            await positionManager_.depositMargin(
                hre.ethers.BigNumber.from(10000).mul(UNIT),
                hre.ethers.constants.HashZero
            )
        ).wait();

        // open eth long, 50000 notional
        await (
            await positionManager_.submitOrder(
                WETH,
                normalized(50),
                normalized(1000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        let orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s

        await expect(positionManager_.executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(
                await account1.getAddress(),
                WETH,
                normalized(50),
                normalized(1000.95),
                normalized(47.5),
                normalized(0)
            );
        let curDay = startOfDay(await helpers.time.latest());
        const curWeek = startOfWeek(await helpers.time.latest());
        // check balances
        let status = await market_.accountMarginStatus(
            await account1.getAddress()
        );
        expect(status.currentMargin).to.deep.eq(normalized(10000 - 47.5));
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq(normalized(1000000 + 42.75));
        expect(await feeTracker_.tradingFeeIncentives(curWeek)).to.deep.eq(
            normalized(4.75)
        );
        expect(await USDC_.balanceOf(feeTracker_.address)).to.deep.eq(
            normalized(4.75)
        );
        // check volume
        expect(
            await volumeTracker_.userWeeklyVolume(
                await account1.getAddress(),
                curWeek
            )
        ).to.deep.eq(normalized(50000));
        expect(
            await volumeTracker_.userDailyVolume(
                await account1.getAddress(),
                curDay
            )
        ).to.deep.eq(normalized(50000));
        let ts = startOfDay(await helpers.time.latest());
        for (let i = 0; i < 10; ++i) {
            expect(await volumeTracker_.luckyCandidates(ts)).to.deep.eq(1);
            expect(
                await volumeTracker_.userLuckyNumber(
                    await account1.getAddress(),
                    ts
                )
            ).to.deep.eq(1);
            ts += DAY;
        }
        expect(await volumeTracker_.luckyCandidates(ts)).to.deep.eq(0);
        expect(
            await volumeTracker_.userLuckyNumber(
                await account1.getAddress(),
                ts
            )
        ).to.deep.eq(0);

        await increaseNextBlockTimestamp(DAY);
        // open eth long, 50000 notional
        await (
            await positionManager_.submitOrder(
                WETH,
                normalized(50),
                normalized(1000),
                normalized(1),
                (await helpers.time.latest()) + DAY + 100
            )
        ).wait();
        orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s

        await expect(positionManager_.executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(
                await account1.getAddress(),
                WETH,
                normalized(50),
                normalized(1000.95),
                normalized(47.5),
                normalized(0)
            );
        // check volume
        curDay += DAY;
        expect(
            await volumeTracker_.userWeeklyVolume(
                await account1.getAddress(),
                curWeek
            )
        ).to.deep.eq(normalized(100000));
        expect(
            await volumeTracker_.userDailyVolume(
                await account1.getAddress(),
                curDay
            )
        ).to.deep.eq(normalized(50000));
        expect(
            await volumeTracker_.userDailyVolume(
                await account1.getAddress(),
                curDay - DAY
            )
        ).to.deep.eq(normalized(50000));
        ts = curDay - DAY;
        for (let i = 0; i < 11; ++i) {
            expect(await volumeTracker_.luckyCandidates(ts)).to.deep.eq(1);
            expect(
                await volumeTracker_.userLuckyNumber(
                    await account1.getAddress(),
                    ts
                )
            ).to.deep.eq(1);
            ts += DAY;
        }
        expect(await volumeTracker_.luckyCandidates(ts)).to.deep.eq(0);
        expect(
            await volumeTracker_.userLuckyNumber(
                await account1.getAddress(),
                ts
            )
        ).to.deep.eq(0);
        status = await market_.accountMarginStatus(await account1.getAddress());
        expect(status.currentMargin).to.deep.eq(normalized(10000 - 95));
    });
    it("claim weekly trading coupon & veSYM incentive", async () => {
        await expect(
            feeTracker_.claimIncentives([await helpers.time.latest()])
        ).to.be.revertedWith("FeeTracker: invalid date");
        await expect(
            volumeTracker_.claimWeeklyTradingFeeCoupon(
                await helpers.time.latest()
            )
        ).to.be.revertedWith("VolumeTracker: invalid date");

        await increaseNextBlockTimestamp(WEEK);
        await expect(feeTracker_.claimIncentives([await helpers.time.latest()]))
            .to.emit(USDC_, "Transfer")
            .withArgs(
                feeTracker_.address,
                await account1.getAddress(),
                "18999999999543421"
            );
        expect(
            await feeTracker_.claimed(
                await account1.getAddress(),
                startOfWeek((await helpers.time.latest()) - WEEK)
            )
        ).to.deep.eq(true);

        await expect(
            volumeTracker_.claimWeeklyTradingFeeCoupon(
                (await helpers.time.latest()) - WEEK
            )
        )
            .to.emit(coupon_, "Minted")
            .withArgs(0, await account1.getAddress(), normalized(1));
    });
    it("redeem coupon", async () => {
        expect(await coupon_.ownerOf(0)).to.deep.eq(
            await account1.getAddress()
        );
        expect(await coupon_.unspents(await account1.getAddress())).to.deep.eq(
            0
        );
        await (await coupon_.connect(account1).redeemCoupon(0)).wait();
        await expect(coupon_.ownerOf(0)).to.be.revertedWith(
            "ERC721: invalid token ID"
        );
        expect(await coupon_.unspents(await account1.getAddress())).to.deep.eq(
            normalized(1)
        );
    });
    it("trade with coupon", async () => {
        // open eth long, 1000 notional
        await (
            await positionManager_.submitOrder(
                WETH,
                normalized(1),
                normalized(1000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        let orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s

        await expect(positionManager_.executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(
                await account1.getAddress(),
                WETH,
                normalized(1),
                normalized(1000),
                normalized(0.95),
                normalized(0.95)
            );

        expect(await coupon_.unspents(await account1.getAddress())).to.deep.eq(
            normalized(0.05)
        );

        // close eth long, 1000 notional
        await (
            await positionManager_.submitOrder(
                WETH,
                normalized(-1),
                normalized(1000),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s

        await expect(positionManager_.executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(
                await account1.getAddress(),
                WETH,
                normalized(-1),
                normalized(999.1),
                normalized(0.95),
                normalized(0.05)
            );
        expect(await coupon_.unspents(await account1.getAddress())).to.deep.eq(
            0
        );
    });
    it("liquidate and mint coupon", async () => {
        const pythUpdateData = await getPythUpdateData(hre, { WETH: 918 });
        await (
            await priceOracle_.updatePythPrice(
                await account1.getAddress(),
                pythUpdateData.updateData,
                { value: pythUpdateData.fee }
            )
        ).wait();

        await increaseNextBlockTimestamp(1);
        const evmTime = (await helpers.time.latest()) + 1;

        // liquidate
        await expect(
            positionManager_
                .connect(account2)
                .liquidatePosition(await account1.getAddress(), WETH, [])
        )
            .to.emit(positionManager_, "Liquidated")
            .withArgs(
                await account1.getAddress(),
                WETH,
                normalized(91800),
                await account2.getAddress(),
                normalized(321.3),
                normalized(826.2),
                normalized(0),
                1
            )
            .to.emit(positionManager_, "LiquidationFee")
            .withArgs(
                await account1.getAddress(),
                normalized(91800),
                await account2.getAddress(),
                normalized(321.3),
                normalized(321.3),
                normalized(0),
                normalized(0)
            )
            .to.emit(positionManager_, "LiquidationPenalty")
            .withArgs(
                await account1.getAddress(),
                normalized(91800),
                await account2.getAddress(),
                normalized(826.2),
                normalized(826.2)
            )
            .to.emit(coupon_, "PreMint")
            .withArgs(
                1,
                await account1.getAddress(),
                normalized(91.8),
                evmTime + WEEK
            );
        await (await coupon_.connect(account1).mintAndRedeem(1)).wait();
        await expect(coupon_.ownerOf(1)).to.be.revertedWith(
            "ERC721: invalid token ID"
        );
        expect(await coupon_.unspents(await account1.getAddress())).to.deep.eq(
            normalized(91.8)
        );
        expect(await coupon_.tokenCount()).to.deep.eq(2);
    });
    it("set functions", async () => {
        volumeTracker_ = volumeTracker_.connect(deployer);
        await volumeTracker_.setMarket(ADDR0);
        await volumeTracker_.setSetting(ADDR0);
        await volumeTracker_.setCoupon(ADDR0);
        expect(await volumeTracker_.market()).to.eq(ADDR0);
        expect(await volumeTracker_.coupon()).to.eq(ADDR0);
        expect(await volumeTracker_.settings()).to.eq(ADDR0);
    });
});
