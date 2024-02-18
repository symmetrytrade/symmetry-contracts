import hre, { deployments } from "hardhat";
import { expect } from "chai";
import { CONTRACTS, MAX_UINT256, MINTER_ROLE, getTypedContract, normalized, usdcOf } from "../src/utils/utils";
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
import {
    CouponStaking,
    FaucetToken,
    FeeTracker,
    LiquidityManager,
    MarginTracker,
    Market,
    MarketSettings,
    PositionManager,
    PriceOracle,
    SYM,
    TradingFeeCoupon,
    VolumeTracker,
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

describe("Coupon", () => {
    let account1: ethers.Signer;
    let account2: ethers.Signer;
    let deployer: ethers.Signer;
    let config: NetworkConfigs;
    let market_: Market;
    let priceOracle_: PriceOracle;
    let positionManager_: PositionManager;
    let liquidityManager_: LiquidityManager;
    let marketSettings_: MarketSettings;
    let marginTracker_: MarginTracker;
    let volumeTracker_: VolumeTracker;
    let votingEscrow_: VotingEscrow;
    let coupon_: TradingFeeCoupon;
    let sym_: SYM;
    let WETH: string;
    let USDC_: FaucetToken;
    let feeTracker_: FeeTracker;
    let couponStaking_: CouponStaking;

    before(async () => {
        deployer = (await hre.ethers.getSigners())[0];
        account1 = (await hre.ethers.getSigners())[1];
        account2 = (await hre.ethers.getSigners())[2];
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH = await (await getTypedContract(hre, CONTRACTS.WETH)).getAddress();
        USDC_ = await getTypedContract(hre, CONTRACTS.USDC);
        market_ = await getTypedContract(hre, CONTRACTS.Market, account1);
        priceOracle_ = await getTypedContract(hre, CONTRACTS.PriceOracle, account1);
        marketSettings_ = await getTypedContract(hre, CONTRACTS.MarketSettings);
        marginTracker_ = await getTypedContract(hre, CONTRACTS.MarginTracker);
        liquidityManager_ = await getTypedContract(hre, CONTRACTS.LiquidityManager, account1);
        positionManager_ = await getTypedContract(hre, CONTRACTS.PositionManager, account1);
        feeTracker_ = await getTypedContract(hre, CONTRACTS.FeeTracker, account1);
        volumeTracker_ = await getTypedContract(hre, CONTRACTS.VolumeTracker, account1);
        votingEscrow_ = await getTypedContract(hre, CONTRACTS.VotingEscrow, account1);
        coupon_ = await getTypedContract(hre, CONTRACTS.TradingFeeCoupon);
        couponStaking_ = await getTypedContract(hre, CONTRACTS.CouponStaking);
        sym_ = await getTypedContract(hre, CONTRACTS.SYM);
        config = getConfig(hre.network.name);

        await USDC_.transfer(await account1.getAddress(), usdcOf(100000000));
        await USDC_.transfer(await account2.getAddress(), usdcOf(100000000));

        // add liquidity
        USDC_ = USDC_.connect(account1);
        await USDC_.approve(await market_.getAddress(), MAX_UINT256);
        const amount = usdcOf(1000000); // 1M
        const minLp = normalized(100000);
        await liquidityManager_.addLiquidity(amount, minLp, await account1.getAddress(), false);

        await USDC_.connect(account2).approve(await market_.getAddress(), MAX_UINT256);

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
        // set liquidation coupon ratio to 10%
        await marketSettings_.setIntVals(
            [hre.ethers.encodeBytes32String("liquidationPenaltyRatio")],
            [normalized(0.009)]
        );
        await marketSettings_.setIntVals(
            [hre.ethers.encodeBytes32String("liquidationCouponRatio")],
            [normalized(0.001)]
        );
        // set debt interest rate to 0%
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("minInterestRate")], [0]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxInterestRate")], [0]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("vertexInterestRate")], [0]);
        // allocate sym
        const maxTime = config.otherConfig.lockMaxTime;
        await sym_.grantRole(MINTER_ROLE, await deployer.getAddress());
        await sym_.mint(await account1.getAddress(), normalized(2));
        await sym_.mint(await account2.getAddress(), normalized(998));
        await sym_.connect(account1).approve(await votingEscrow_.getAddress(), normalized(2));
        await votingEscrow_.connect(account1).createLock(normalized(2), 0, maxTime, true);
        await sym_.connect(account2).approve(await votingEscrow_.getAddress(), normalized(998));
        await votingEscrow_.connect(account2).createLock(normalized(998), 0, maxTime, true);

        await helpers.time.setNextBlockTimestamp(startOfWeek((await helpers.time.latest()) + maxTime));

        await setPythAutoRefresh(hre);

        expect(await couponStaking_.DISCOUNT_START()).to.eq(0);
        expect(await couponStaking_.DISCOUNT_END()).to.eq(10000000);
    });

    it("trade with tiered trading fee discount", async () => {
        positionManager_ = positionManager_.connect(account1);
        // deposit margins
        await positionManager_.depositMargin(await USDC_.getAddress(), usdcOf(10000), hre.ethers.ZeroHash);

        // open eth long, 50000 notional
        await positionManager_.submitOrder({
            token: WETH,
            size: normalized(50),
            acceptablePrice: normalized(1001),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        let orderId = (await positionManager_.orderCnt()) - 1n;

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
        expect(status.currentMargin).to.eq(normalized(10000 - 47.5 - 1));
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.eq(normalized(1000000 + 42.75));
        expect(await feeTracker_.tradingFeeIncentives(curWeek)).to.eq(usdcOf(4.75));
        expect(await marginTracker_.userCollaterals(await feeTracker_.getAddress(), await USDC_.getAddress())).to.eq(
            usdcOf(4.75)
        );
        // check volume
        expect(await volumeTracker_.userWeeklyVolume(await account1.getAddress(), curWeek)).to.eq(normalized(50047.5));
        expect(await volumeTracker_.userDailyVolume(await account1.getAddress(), curDay)).to.eq(normalized(50047.5));
        let ts = startOfDay(await helpers.time.latest());
        for (let i = 0; i < 10; ++i) {
            expect(await volumeTracker_.luckyCandidates(ts)).to.eq(1);
            expect(await volumeTracker_.userLuckyNumber(await account1.getAddress(), ts)).to.eq(1);
            ts += DAY;
        }
        expect(await volumeTracker_.luckyCandidates(ts)).to.eq(0);
        expect(await volumeTracker_.userLuckyNumber(await account1.getAddress(), ts)).to.eq(0);

        await increaseNextBlockTimestamp(DAY);
        // open eth long, 50000 notional
        await positionManager_.submitOrder({
            token: WETH,
            size: normalized(50),
            acceptablePrice: normalized(1001),
            keeperFee: usdcOf(1),
            expiry: BigInt(await helpers.time.latest()) + DAY + 100n,
            reduceOnly: false,
        });
        orderId = (await positionManager_.orderCnt()) - 1n;

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
        expect(await volumeTracker_.userWeeklyVolume(await account1.getAddress(), curWeek)).to.eq(normalized(100095));
        expect(await volumeTracker_.userDailyVolume(await account1.getAddress(), curDay)).to.eq(normalized(50047.5));
        expect(await volumeTracker_.userDailyVolume(await account1.getAddress(), curDay - DAY)).to.eq(
            normalized(50047.5)
        );
        ts = curDay - DAY;
        for (let i = 0; i < 11; ++i) {
            expect(await volumeTracker_.luckyCandidates(ts)).to.eq(1);
            expect(await volumeTracker_.userLuckyNumber(await account1.getAddress(), ts)).to.eq(1);
            ts += DAY;
        }
        expect(await volumeTracker_.luckyCandidates(ts)).to.eq(0);
        expect(await volumeTracker_.userLuckyNumber(await account1.getAddress(), ts)).to.eq(0);
        status = await market_.accountMarginStatus(await account1.getAddress());
        expect(status.currentMargin).to.eq(normalized(10000 - 95 - 2));
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

        expect(await feeTracker_.claimIncentives.staticCall(await account1.getAddress())).to.eq(0);

        await volumeTracker_.issueLuckyNumber(startOfWeek(await helpers.time.latest()) - DAY);
        await helpers.mine(3);
        await volumeTracker_.drawLuckyNumber(startOfWeek(await helpers.time.latest()) - DAY);
        await expect(volumeTracker_.claimWeeklyTradingFeeCoupon([BigInt(await helpers.time.latest()) - WEEK]))
            .to.emit(coupon_, "Minted")
            .withArgs(0, await account1.getAddress(), normalized(1));
    });
    it("apply coupon", async () => {
        expect(await coupon_.ownerOf(0)).to.eq(await account1.getAddress());
        expect(await coupon_.unspents(await account1.getAddress())).to.eq(0);

        //console.log(await coupon_.tokenURI(0));

        await coupon_.connect(account1).applyCoupons([0]);
        await expect(coupon_.ownerOf(0)).to.be.revertedWith("ERC721: invalid token ID");
        expect(await coupon_.unspents(await account1.getAddress())).to.eq(normalized(1));
    });
    it("trade with coupon", async () => {
        // open eth long, 1000 notional
        await positionManager_.submitOrder({
            token: WETH,
            size: normalized(1),
            acceptablePrice: normalized(1010),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        let orderId = (await positionManager_.orderCnt()) - 1n;

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

        expect(await coupon_.unspents(await account1.getAddress())).to.eq(normalized(0.05));

        // close eth long, 1000 notional
        await positionManager_.submitOrder({
            token: WETH,
            size: normalized(-1),
            acceptablePrice: normalized(999),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: true,
        });
        orderId = (await positionManager_.orderCnt()) - 1n;

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
        expect(await coupon_.unspents(await account1.getAddress())).to.eq(0);
    });
    it("liquidate and mint coupon", async () => {
        const pythUpdateData = await getPythUpdateData(hre, { WETH: 918 });
        await priceOracle_.updatePythPrice(pythUpdateData.updateData, {
            value: pythUpdateData.fee,
        });

        await increaseNextBlockTimestamp(1);
        const evmTime = BigInt(await helpers.time.latest()) + 1n;

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
        await coupon_.connect(account1).mintAndApply(1);
        await expect(coupon_.ownerOf(1)).to.be.revertedWith("ERC721: invalid token ID");
        expect(await coupon_.unspents(await account1.getAddress())).to.eq(normalized(91));
        expect(await coupon_.tokenCount()).to.eq(2);
    });
    it("lucky number", async () => {
        await helpers.time.setNextBlockTimestamp(startOfWeek(await helpers.time.latest()) + WEEK);
        await helpers.mine();
        await expect(volumeTracker_.drawLuckyNumber(await helpers.time.latest())).to.be.revertedWith(
            "VolumeTracker: not issued"
        );
        await volumeTracker_.issueLuckyNumber(await helpers.time.latest());
        await expect(volumeTracker_.drawLuckyNumber(await helpers.time.latest())).to.be.revertedWith(
            "VolumeTracker: hash unavailable"
        );
        await helpers.mine(5);
        await volumeTracker_.drawLuckyNumber(await helpers.time.latest());
        await expect(volumeTracker_.drawLuckyNumber(await helpers.time.latest())).to.be.revertedWith(
            "VolumeTracker: drawed"
        );

        await helpers.time.setNextBlockTimestamp(startOfWeek(await helpers.time.latest()) + WEEK);
        await helpers.mine();
        await volumeTracker_.issueLuckyNumber(await helpers.time.latest());
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
        await volumeTracker_.drawLuckyNumberByAnnouncer(
            await helpers.time.latest(),
            hre.ethers.ZeroHash,
            hre.ethers.ZeroHash,
            hre.ethers.ZeroHash
        );
        const t = startOfDay(await helpers.time.latest()) - DAY;
        expect(await volumeTracker_.luckyNumber(t)).to.eq(
            "0x46700b4d40ac5c35af2c22dda2787a91eb567b06c924a8fb8ae9a05b20c08c22"
        );
    });
});
