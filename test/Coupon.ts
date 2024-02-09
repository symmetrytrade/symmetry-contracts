import hre, { deployments } from "hardhat";
import { expect } from "chai";
import { CONTRACTS, MAX_UINT256, MINTER_ROLE, getProxyContract, normalized, usdcOf } from "../src/utils/utils";
import {
    DAY,
    WEEK,
    getPythUpdateData,
    increaseNextBlockTimestamp,
    setPythAutoRefresh,
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
    let marginTracker_: ethers.Contract;
    let volumeTracker_: ethers.Contract;
    let votingEscrow_: ethers.Contract;
    let coupon_: ethers.Contract;
    let sym_: ethers.Contract;
    let WETH: string;
    let USDC_: ethers.Contract;
    let feeTracker_: ethers.Contract;
    let couponStaking_: ethers.Contract;

    before(async () => {
        deployer = (await hre.ethers.getSigners())[0];
        account1 = (await hre.ethers.getSigners())[1];
        account2 = (await hre.ethers.getSigners())[2];
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH = await (await hre.ethers.getContract("WETH")).getAddress();
        USDC_ = await hre.ethers.getContract("USDC", deployer);
        market_ = await getProxyContract(hre, CONTRACTS.Market, account1);
        priceOracle_ = await getProxyContract(hre, CONTRACTS.PriceOracle, account1);
        marketSettings_ = await getProxyContract(hre, CONTRACTS.MarketSettings, deployer);
        marginTracker_ = await getProxyContract(hre, CONTRACTS.MarginTracker, deployer);
        liquidityManager_ = await getProxyContract(hre, CONTRACTS.LiquidityManager, account1);
        positionManager_ = await getProxyContract(hre, CONTRACTS.PositionManager, account1);
        feeTracker_ = await getProxyContract(hre, CONTRACTS.FeeTracker, account1);
        volumeTracker_ = await getProxyContract(hre, CONTRACTS.VolumeTracker, account1);
        votingEscrow_ = await getProxyContract(hre, CONTRACTS.VotingEscrow, account1);
        coupon_ = await getProxyContract(hre, CONTRACTS.TradingFeeCoupon, deployer);
        couponStaking_ = await getProxyContract(hre, CONTRACTS.CouponStaking, deployer);
        sym_ = await hre.ethers.getContract(CONTRACTS.SYM.name, deployer);
        config = getConfig(hre.network.name);

        await (await USDC_.transfer(await account1.getAddress(), usdcOf(100000000))).wait();
        await (await USDC_.transfer(await account2.getAddress(), usdcOf(100000000))).wait();

        // add liquidity
        USDC_ = USDC_.connect(account1);
        await (await USDC_.approve(await market_.getAddress(), MAX_UINT256)).wait();
        const amount = usdcOf(1000000); // 1M
        const minLp = normalized(100000);
        await (await liquidityManager_.addLiquidity(amount, minLp, await account1.getAddress(), false)).wait();

        await (await USDC_.connect(account2).approve(await market_.getAddress(), MAX_UINT256)).wait();

        // set financing&funding fee rate to zero
        await (await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxFundingVelocity")], [0])).wait();
        await (await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxFinancingFeeRate")], [0])).wait();
        // for convenience of following test, set divergence to 200%
        await (
            await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxPriceDivergence")], [normalized(2)])
        ).wait();
        await (
            await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("pythMaxAge")], [normalized(10000)])
        ).wait();
        // set slippage to zero
        await (await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("liquidityRange")], [0])).wait();
        // set veSYM incentive ratio to 10%
        await (
            await marketSettings_.setIntVals(
                [hre.ethers.encodeBytes32String("veSYMFeeIncentiveRatio")],
                [normalized(0.1)]
            )
        ).wait();
        // set liquidation coupon ratio to 10%
        await (
            await marketSettings_.setIntVals(
                [hre.ethers.encodeBytes32String("liquidationPenaltyRatio")],
                [normalized(0.009)]
            )
        ).wait();
        await (
            await marketSettings_.setIntVals(
                [hre.ethers.encodeBytes32String("liquidationCouponRatio")],
                [normalized(0.001)]
            )
        ).wait();
        // set debt interest rate to 0%
        await (await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("minInterestRate")], [0])).wait();
        await (await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxInterestRate")], [0])).wait();
        await (await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("vertexInterestRate")], [0])).wait();
        // allocate sym
        const maxTime = config.otherConfig.lockMaxTime;
        await (await sym_.grantRole(MINTER_ROLE, await deployer.getAddress())).wait();
        await (await sym_.mint(await account1.getAddress(), normalized(2))).wait();
        await (await sym_.mint(await account2.getAddress(), normalized(998))).wait();
        await (await sym_.connect(account1).approve(await votingEscrow_.getAddress(), normalized(2))).wait();
        await (await votingEscrow_.connect(account1).createLock(normalized(2), 0, maxTime, true)).wait();
        await (await sym_.connect(account2).approve(await votingEscrow_.getAddress(), normalized(998))).wait();
        await (await votingEscrow_.connect(account2).createLock(normalized(998), 0, maxTime, true)).wait();

        await helpers.time.setNextBlockTimestamp(startOfWeek((await helpers.time.latest()) + maxTime));

        await setPythAutoRefresh(hre);

        expect(await couponStaking_.DISCOUNT_START()).to.deep.eq(0);
        expect(await couponStaking_.DISCOUNT_END()).to.deep.eq(10000000);
    });

    it("trade with tiered trading fee discount", async () => {
        positionManager_ = positionManager_.connect(account1);
        // deposit margins
        await (
            await positionManager_.depositMargin(await USDC_.getAddress(), usdcOf(10000), hre.ethers.ZeroHash)
        ).wait();

        // open eth long, 50000 notional
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
        let orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await expect(positionManager_.connect(deployer).executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(
                await account1.getAddress(),
                WETH,
                normalized(50),
                normalized(1000.95),
                normalized(47.5),
                normalized(0),
                orderId
            );
        let curDay = startOfDay(await helpers.time.latest());
        const curWeek = startOfWeek(await helpers.time.latest());
        // check balances
        let status = await market_.accountMarginStatus(await account1.getAddress());
        expect(status.currentMargin).to.deep.eq(normalized(10000 - 47.5 - 1));
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq(normalized(1000000 + 42.75));
        expect(await feeTracker_.tradingFeeIncentives(curWeek)).to.deep.eq(usdcOf(4.75));
        expect(
            await marginTracker_.userCollaterals(await feeTracker_.getAddress(), await USDC_.getAddress())
        ).to.deep.eq(usdcOf(4.75));
        // check volume
        expect(await volumeTracker_.userWeeklyVolume(await account1.getAddress(), curWeek)).to.deep.eq(
            normalized(50047.5)
        );
        expect(await volumeTracker_.userDailyVolume(await account1.getAddress(), curDay)).to.deep.eq(
            normalized(50047.5)
        );
        let ts = startOfDay(await helpers.time.latest());
        for (let i = 0; i < 10; ++i) {
            expect(await volumeTracker_.luckyCandidates(ts)).to.deep.eq(1);
            expect(await volumeTracker_.userLuckyNumber(await account1.getAddress(), ts)).to.deep.eq(1);
            ts += DAY;
        }
        expect(await volumeTracker_.luckyCandidates(ts)).to.deep.eq(0);
        expect(await volumeTracker_.userLuckyNumber(await account1.getAddress(), ts)).to.deep.eq(0);

        await increaseNextBlockTimestamp(DAY);
        // open eth long, 50000 notional
        await (
            await positionManager_.submitOrder([
                WETH,
                normalized(50),
                normalized(1001),
                usdcOf(1),
                (await helpers.time.latest()) + DAY + 100,
                false,
            ])
        ).wait();
        orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await expect(positionManager_.connect(deployer).executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(
                await account1.getAddress(),
                WETH,
                normalized(50),
                normalized(1000.95),
                normalized(47.5),
                normalized(0),
                orderId
            );
        // check volume
        curDay += DAY;
        expect(await volumeTracker_.userWeeklyVolume(await account1.getAddress(), curWeek)).to.deep.eq(
            normalized(100095)
        );
        expect(await volumeTracker_.userDailyVolume(await account1.getAddress(), curDay)).to.deep.eq(
            normalized(50047.5)
        );
        expect(await volumeTracker_.userDailyVolume(await account1.getAddress(), curDay - DAY)).to.deep.eq(
            normalized(50047.5)
        );
        ts = curDay - DAY;
        for (let i = 0; i < 11; ++i) {
            expect(await volumeTracker_.luckyCandidates(ts)).to.deep.eq(1);
            expect(await volumeTracker_.userLuckyNumber(await account1.getAddress(), ts)).to.deep.eq(1);
            ts += DAY;
        }
        expect(await volumeTracker_.luckyCandidates(ts)).to.deep.eq(0);
        expect(await volumeTracker_.userLuckyNumber(await account1.getAddress(), ts)).to.deep.eq(0);
        status = await market_.accountMarginStatus(await account1.getAddress());
        expect(status.currentMargin).to.deep.eq(normalized(10000 - 95 - 2));
    });
    it("claim weekly trading coupon & veSYM incentive", async () => {
        await increaseNextBlockTimestamp(WEEK);
        const weekCursor = startOfWeek(await helpers.time.latest()) + WEEK;
        await expect(feeTracker_.claimIncentives(await account1.getAddress()))
            .to.emit(feeTracker_, "Claimed")
            .withArgs(await account1.getAddress(), weekCursor, "18999");
        await expect(volumeTracker_.claimWeeklyTradingFeeCoupon([await helpers.time.latest()])).to.be.revertedWith(
            "VolumeTracker: invalid date"
        );

        expect(await feeTracker_.claimIncentives.staticCall(await account1.getAddress())).to.deep.eq(0);

        await (await volumeTracker_.issueLuckyNumber(startOfWeek(await helpers.time.latest()) - DAY)).wait();
        await helpers.mine(3);
        await (await volumeTracker_.drawLuckyNumber(startOfWeek(await helpers.time.latest()) - DAY)).wait();
        await expect(volumeTracker_.claimWeeklyTradingFeeCoupon([(await helpers.time.latest()) - WEEK]))
            .to.emit(coupon_, "Minted")
            .withArgs(0, await account1.getAddress(), normalized(1));
    });
    it("apply coupon", async () => {
        expect(await coupon_.ownerOf(0)).to.deep.eq(await account1.getAddress());
        expect(await coupon_.unspents(await account1.getAddress())).to.deep.eq(0);

        //console.log(await coupon_.tokenURI(0));

        await (await coupon_.connect(account1).applyCoupons([0])).wait();
        await expect(coupon_.ownerOf(0)).to.be.revertedWith("ERC721: invalid token ID");
        expect(await coupon_.unspents(await account1.getAddress())).to.deep.eq(normalized(1));
    });
    it("trade with coupon", async () => {
        // open eth long, 1000 notional
        await (
            await positionManager_.submitOrder([
                WETH,
                normalized(1),
                normalized(1010),
                usdcOf(1),
                (await helpers.time.latest()) + 100,
                false,
            ])
        ).wait();
        let orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await expect(positionManager_.executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(
                await account1.getAddress(),
                WETH,
                normalized(1),
                normalized(1000),
                normalized(0.95),
                normalized(0.95),
                orderId
            );

        expect(await coupon_.unspents(await account1.getAddress())).to.deep.eq(normalized(0.05));

        // close eth long, 1000 notional
        await (
            await positionManager_.submitOrder([
                WETH,
                normalized(-1),
                normalized(999),
                usdcOf(1),
                (await helpers.time.latest()) + 100,
                true,
            ])
        ).wait();
        orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await expect(positionManager_.executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(
                await account1.getAddress(),
                WETH,
                normalized(-1),
                normalized(999.1),
                normalized(0.95),
                normalized(0.05),
                orderId
            );
        expect(await coupon_.unspents(await account1.getAddress())).to.deep.eq(0);
    });
    it("liquidate and mint coupon", async () => {
        const pythUpdateData = await getPythUpdateData(hre, { WETH: 918 });
        await (
            await priceOracle_.updatePythPrice(pythUpdateData.updateData, {
                value: pythUpdateData.fee,
            })
        ).wait();

        await increaseNextBlockTimestamp(1);
        const evmTime = (await helpers.time.latest()) + 1;

        // liquidate
        await expect(positionManager_.connect(account2).liquidatePosition(await account1.getAddress(), WETH, []))
            .to.emit(positionManager_, "Liquidated")
            .withArgs(
                await account1.getAddress(),
                WETH,
                normalized(100),
                normalized(91800),
                normalized(321.3),
                normalized(826.2),
                1
            )
            .to.emit(positionManager_, "LiquidationFee")
            .withArgs(await account1.getAddress(), normalized(91800), normalized(321.3), usdcOf(321.3))
            .to.emit(positionManager_, "LiquidationPenalty")
            .withArgs(await account1.getAddress(), normalized(91800), normalized(826.2), usdcOf(826.2))
            .to.emit(coupon_, "PreMint")
            .withArgs(1, await account1.getAddress(), normalized(91), evmTime + WEEK);
        await (await coupon_.connect(account1).mintAndApply(1)).wait();
        await expect(coupon_.ownerOf(1)).to.be.revertedWith("ERC721: invalid token ID");
        expect(await coupon_.unspents(await account1.getAddress())).to.deep.eq(normalized(91));
        expect(await coupon_.tokenCount()).to.deep.eq(2);
    });
    it("lucky number", async () => {
        await helpers.time.setNextBlockTimestamp(startOfWeek((await helpers.time.latest()) + WEEK));
        await helpers.mine();
        await expect(volumeTracker_.drawLuckyNumber(await helpers.time.latest())).to.be.revertedWith(
            "VolumeTracker: not issued"
        );
        await (await volumeTracker_.issueLuckyNumber(await helpers.time.latest())).wait();
        await expect(volumeTracker_.drawLuckyNumber(await helpers.time.latest())).to.be.revertedWith(
            "VolumeTracker: hash unavailable"
        );
        await helpers.mine(5);
        await (await volumeTracker_.drawLuckyNumber(await helpers.time.latest())).wait();
        await expect(volumeTracker_.drawLuckyNumber(await helpers.time.latest())).to.be.revertedWith(
            "VolumeTracker: drawed"
        );

        await helpers.time.setNextBlockTimestamp(startOfWeek((await helpers.time.latest()) + WEEK));
        await helpers.mine();
        await (await volumeTracker_.issueLuckyNumber(await helpers.time.latest())).wait();
        await expect(
            volumeTracker_.drawLuckyNumberByAnnouncer(
                await helpers.time.latest(),
                hre.ethers.ZeroHash,
                hre.ethers.ZeroHash,
                hre.ethers.ZeroHash
            )
        ).to.be.revertedWith("VolumeTracker: forbid");
        volumeTracker_ = volumeTracker_.connect(deployer);
        await expect(
            volumeTracker_.drawLuckyNumberByAnnouncer(
                await helpers.time.latest(),
                hre.ethers.ZeroHash,
                hre.ethers.ZeroHash,
                hre.ethers.ZeroHash
            )
        ).to.be.revertedWith("VolumeTracker: too early");
        await helpers.mine(300);
        await expect(volumeTracker_.drawLuckyNumber(await helpers.time.latest())).to.be.revertedWith(
            "VolumeTracker: hash unavailable"
        );
        await (
            await volumeTracker_.drawLuckyNumberByAnnouncer(
                await helpers.time.latest(),
                hre.ethers.ZeroHash,
                hre.ethers.ZeroHash,
                hre.ethers.ZeroHash
            )
        ).wait();
        const t = startOfDay(await helpers.time.latest()) - DAY;
        expect(await volumeTracker_.luckyNumber(t)).to.deep.eq(
            "0x46700b4d40ac5c35af2c22dda2787a91eb567b06c924a8fb8ae9a05b20c08c22"
        );
    });
});
