import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { encodeBytes32String, MaxUint256, Signer, ZeroHash } from "ethers";
import hre, { deployments } from "hardhat";
import { getConfig, NetworkConfigs } from "../src/config";
import {
    DAY,
    getPythUpdateData,
    increaseNextBlockTimestamp,
    setPythAutoRefresh,
    setupPrices,
    startOfDay,
    startOfWeek,
    WEEK,
} from "../src/utils/test_utils";
import { CONTRACTS, getTypedContract, MINTER_ROLE, normalized, usdcOf } from "../src/utils/utils";
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
    let account1: Signer;
    let account2: Signer;
    let deployer: Signer;
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
    let WETH_: FaucetToken;
    let USDC_: FaucetToken;
    let feeTracker_: FeeTracker;
    let couponStaking_: CouponStaking;

    before(async () => {
        [deployer, account1, account2] = await hre.ethers.getSigners();
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH_ = await getTypedContract(hre, CONTRACTS.WETH);
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

        await USDC_.transfer(account1, usdcOf(100000000));
        await USDC_.transfer(account2, usdcOf(100000000));

        // add liquidity
        USDC_ = USDC_.connect(account1);
        await USDC_.approve(market_, MaxUint256);
        const amount = usdcOf(1000000); // 1M
        const minLp = normalized(100000);
        await liquidityManager_.addLiquidity(amount, minLp, account1, false);

        await USDC_.connect(account2).approve(market_, MaxUint256);

        // set financing&funding fee rate to zero
        await marketSettings_.setIntVals([encodeBytes32String("maxFundingVelocity")], [0]);
        await marketSettings_.setIntVals([encodeBytes32String("maxFinancingFeeRate")], [0]);
        // for convenience of following test, set divergence to 200%
        await marketSettings_.setIntVals([encodeBytes32String("maxPriceDivergence")], [normalized(2)]);
        await marketSettings_.setIntVals([encodeBytes32String("pythMaxAge")], [normalized(10000)]);
        // set slippage to zero
        await marketSettings_.setIntVals([encodeBytes32String("liquidityRange")], [0]);
        // set veSYM incentive ratio to 10%
        await marketSettings_.setIntVals([encodeBytes32String("veSYMFeeIncentiveRatio")], [normalized("0.1")]);
        // set perp taker fee to 0.1%, maker fee to 0
        await marketSettings_.setIntVals([encodeBytes32String("perpTakerFee")], [normalized("0.001")]);
        await marketSettings_.setIntVals([encodeBytes32String("perpMakerFee")], [0]);
        // set liquidation coupon ratio to 10%
        await marketSettings_.setIntVals([encodeBytes32String("liquidationPenaltyRatio")], [normalized("0.009")]);
        await marketSettings_.setIntVals([encodeBytes32String("liquidationCouponRatio")], [normalized("0.001")]);
        // set debt interest rate to 0%
        await marketSettings_.setIntVals([encodeBytes32String("minInterestRate")], [0]);
        await marketSettings_.setIntVals([encodeBytes32String("maxInterestRate")], [0]);
        await marketSettings_.setIntVals([encodeBytes32String("vertexInterestRate")], [0]);
        // allocate sym
        const maxTime = config.otherConfig.lockMaxTime;
        await sym_.grantRole(MINTER_ROLE, deployer);
        await sym_.mint(account1, normalized(2));
        await sym_.mint(account2, normalized(998));
        await sym_.connect(account1).approve(votingEscrow_, normalized(2));
        await votingEscrow_.connect(account1).createLock(normalized(2), 0, maxTime, true);
        await sym_.connect(account2).approve(votingEscrow_, normalized(998));
        await votingEscrow_.connect(account2).createLock(normalized(998), 0, maxTime, true);

        await helpers.time.setNextBlockTimestamp(startOfWeek((await helpers.time.latest()) + maxTime));

        await setPythAutoRefresh(hre);

        expect(await couponStaking_.DISCOUNT_START()).to.eq(0);
        expect(await couponStaking_.DISCOUNT_END()).to.eq(10000000);
    });

    it("trade with tiered trading fee discount", async () => {
        positionManager_ = positionManager_.connect(account1);
        // deposit margins
        await positionManager_.depositMargin(USDC_, usdcOf(10000), ZeroHash);

        // open eth long, 50000 notional
        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(50),
            acceptablePrice: normalized(1001),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
            stopLoss: false,
        });
        let orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await expect(positionManager_.connect(deployer).executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(account1, WETH_, normalized(50), normalized("1000"), normalized("47.5"), normalized(0), orderId);
        let curDay = startOfDay(await helpers.time.latest());
        const curWeek = startOfWeek(await helpers.time.latest());
        // check balances
        let status = await market_.accountMarginStatus(account1);
        expect(status.currentMargin).to.eq(normalized(10000) - normalized("47.5") - normalized(1));
        const globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.eq(normalized(1000000) + normalized("42.75"));
        expect(await feeTracker_.tradingFeeIncentives(curWeek)).to.eq(usdcOf("4.75"));
        expect(await marginTracker_.userCollaterals(feeTracker_, USDC_)).to.eq(usdcOf("4.75"));
        // check volume
        expect(await volumeTracker_.userWeeklyVolume(account1, curWeek)).to.eq(normalized("50000"));
        expect(await volumeTracker_.userDailyVolume(account1, curDay)).to.eq(normalized("50000"));
        let ts = startOfDay(await helpers.time.latest());
        for (let i = 0; i < 10; ++i) {
            expect(await volumeTracker_.luckyCandidates(ts)).to.eq(1);
            expect(await volumeTracker_.userLuckyNumber(account1, ts)).to.eq(1);
            ts += DAY;
        }
        expect(await volumeTracker_.luckyCandidates(ts)).to.eq(0);
        expect(await volumeTracker_.userLuckyNumber(account1, ts)).to.eq(0);

        await increaseNextBlockTimestamp(DAY);
        // open eth long, 50000 notional
        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(50),
            acceptablePrice: normalized(1001),
            keeperFee: usdcOf(1),
            expiry: BigInt(await helpers.time.latest()) + DAY + 100n,
            reduceOnly: false,
            stopLoss: false,
        });
        orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await expect(positionManager_.connect(deployer).executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(account1, WETH_, normalized(50), normalized("1000"), normalized("47.5"), normalized(0), orderId);
        // check volume
        curDay += DAY;
        expect(await volumeTracker_.userWeeklyVolume(account1, curWeek)).to.eq(normalized(100000));
        expect(await volumeTracker_.userDailyVolume(account1, curDay)).to.eq(normalized("50000"));
        expect(await volumeTracker_.userDailyVolume(account1, curDay - DAY)).to.eq(normalized("50000"));
        ts = curDay - DAY;
        for (let i = 0; i < 11; ++i) {
            expect(await volumeTracker_.luckyCandidates(ts)).to.eq(1);
            expect(await volumeTracker_.userLuckyNumber(account1, ts)).to.eq(1);
            ts += DAY;
        }
        expect(await volumeTracker_.luckyCandidates(ts)).to.eq(0);
        expect(await volumeTracker_.userLuckyNumber(account1, ts)).to.eq(0);
        status = await market_.accountMarginStatus(account1);
        expect(status.currentMargin).to.eq(normalized(10000 - 95 - 2));
    });
    it("claim weekly trading coupon & veSYM incentive", async () => {
        await increaseNextBlockTimestamp(WEEK);
        const weekCursor = startOfWeek(await helpers.time.latest()) + WEEK;
        await expect(feeTracker_.claimIncentives(account1))
            .to.emit(feeTracker_, "Claimed")
            .withArgs(account1, weekCursor, "18999");
        await expect(volumeTracker_.claimWeeklyTradingFeeCoupon([await helpers.time.latest()])).to.be.revertedWith(
            "VolumeTracker: invalid date"
        );

        expect(await feeTracker_.claimIncentives.staticCall(account1)).to.eq(0);

        await volumeTracker_.issueLuckyNumber(startOfWeek(await helpers.time.latest()) - DAY);
        await helpers.mine(3);
        await volumeTracker_.drawLuckyNumber(startOfWeek(await helpers.time.latest()) - DAY);
        await expect(volumeTracker_.claimWeeklyTradingFeeCoupon([BigInt(await helpers.time.latest()) - WEEK]))
            .to.emit(coupon_, "Minted")
            .withArgs(0, account1, normalized(1));
    });
    it("apply coupon", async () => {
        expect(await coupon_.ownerOf(0)).to.eq(account1);
        expect(await coupon_.unspents(account1)).to.eq(0);

        //console.log(await coupon_.tokenURI(0));

        await coupon_.connect(account1).applyCoupons([0]);
        await expect(coupon_.ownerOf(0)).to.be.revertedWith("ERC721: invalid token ID");
        expect(await coupon_.unspents(account1)).to.eq(normalized(1));
    });
    it("trade with coupon", async () => {
        // open eth long, 1000 notional
        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(1),
            acceptablePrice: normalized(1010),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
            stopLoss: false,
        });
        let orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await expect(positionManager_.executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(
                account1,
                WETH_,
                normalized(1),
                normalized(1000),
                normalized("0.95"),
                normalized("0.95"),
                orderId
            );

        expect(await coupon_.unspents(account1)).to.eq(normalized("0.05"));

        // close eth long, 1000 notional
        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(-1),
            acceptablePrice: normalized(999),
            keeperFee: usdcOf(1),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: true,
            stopLoss: false,
        });
        orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        // swap maker/taker fee, following trades are all maker
        await marketSettings_.setIntVals([encodeBytes32String("perpMakerFee")], [normalized("0.001")]);
        await marketSettings_.setIntVals([encodeBytes32String("perpTakerFee")], [0]);

        await expect(positionManager_.executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(
                account1,
                WETH_,
                normalized(-1),
                normalized("1000"),
                normalized("0.95"),
                normalized("0.05"),
                orderId
            );
        expect(await coupon_.unspents(account1)).to.eq(0);
    });
    it("liquidate and mint coupon", async () => {
        const pythUpdateData = await getPythUpdateData(hre, { WETH: 918 });
        await priceOracle_.updatePythPrice(pythUpdateData.updateData, {
            value: pythUpdateData.fee,
        });

        await increaseNextBlockTimestamp(1);
        const evmTime = BigInt(await helpers.time.latest()) + 1n;

        // liquidate
        await expect(positionManager_.connect(account2).liquidatePosition(account1, WETH_, []))
            .to.emit(positionManager_, "Liquidated")
            .withArgs(account1, WETH_, normalized(100), normalized(91800), normalized("321.3"), normalized("826.2"), 1)
            .to.emit(positionManager_, "LiquidationFee")
            .withArgs(account1, normalized(91800), normalized("321.3"), usdcOf("321.3"))
            .to.emit(positionManager_, "LiquidationPenalty")
            .withArgs(account1, normalized(91800), normalized("826.2"), usdcOf("826.2"))
            .to.emit(coupon_, "PreMint")
            .withArgs(1, account1, normalized(91), evmTime + WEEK);
        await coupon_.connect(account1).mintAndApply(1);
        await expect(coupon_.ownerOf(1)).to.be.revertedWith("ERC721: invalid token ID");
        expect(await coupon_.unspents(account1)).to.eq(normalized(91));
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
            volumeTracker_.drawLuckyNumberByAnnouncer(await helpers.time.latest(), ZeroHash, ZeroHash, ZeroHash)
        ).to.be.revertedWith("VolumeTracker: forbid");
        volumeTracker_ = volumeTracker_.connect(deployer);
        await expect(
            volumeTracker_.drawLuckyNumberByAnnouncer(await helpers.time.latest(), ZeroHash, ZeroHash, ZeroHash)
        ).to.be.revertedWith("VolumeTracker: too early");
        await helpers.mine(300);
        await expect(volumeTracker_.drawLuckyNumber(await helpers.time.latest())).to.be.revertedWith(
            "VolumeTracker: hash unavailable"
        );
        await volumeTracker_.drawLuckyNumberByAnnouncer(await helpers.time.latest(), ZeroHash, ZeroHash, ZeroHash);
        const t = startOfDay(await helpers.time.latest()) - DAY;
        expect(await volumeTracker_.luckyNumber(t)).to.eq(
            "0x46700b4d40ac5c35af2c22dda2787a91eb567b06c924a8fb8ae9a05b20c08c22"
        );
    });
});
