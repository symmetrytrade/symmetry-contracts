import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { encodeBytes32String, MaxUint256, Signer, ZeroHash } from "ethers";
import hre, { deployments } from "hardhat";
import { getConfig, NetworkConfigs } from "../src/config";
import {
    getPythUpdateData,
    increaseNextBlockTimestamp,
    setPythAutoRefresh,
    setupPrices,
} from "../src/utils/test_utils";
import { CONTRACTS, getTypedContract, normalized, UNIT, usdcOf } from "../src/utils/utils";
import {
    FaucetToken,
    LiquidityManager,
    LPToken,
    Market,
    MarketSettings,
    PerpTracker,
    PositionManager,
} from "../typechain-types";

const chainlinkPrices: { [key: string]: string | number } = {
    Sequencer: 0,
    USDC: "0.98",
    WETH: 1500,
    WBTC: 20000,
};

const pythPrices: { [key: string]: string | number } = {
    USDC: "0.98",
    WETH: 1500,
    WBTC: 20000,
};

describe("Liquidity", () => {
    let deployer: Signer;
    let account1: Signer;
    let config: NetworkConfigs;
    let market_: Market;
    let perpTracker_: PerpTracker;
    let positionManager_: PositionManager;
    let liquidityManager_: LiquidityManager;
    let lpToken_: LPToken;
    let WETH_: FaucetToken;
    let USDC_: FaucetToken;
    let marketSettings_: MarketSettings;

    before(async () => {
        [deployer, account1] = await hre.ethers.getSigners();
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH_ = await getTypedContract(hre, CONTRACTS.WETH);
        USDC_ = await getTypedContract(hre, CONTRACTS.USDC);
        market_ = await getTypedContract(hre, CONTRACTS.Market, account1);
        lpToken_ = await getTypedContract(hre, CONTRACTS.LPToken, account1);
        perpTracker_ = await getTypedContract(hre, CONTRACTS.PerpTracker, account1);
        liquidityManager_ = await getTypedContract(hre, CONTRACTS.LiquidityManager, account1);
        positionManager_ = await getTypedContract(hre, CONTRACTS.PositionManager, account1);
        marketSettings_ = await getTypedContract(hre, CONTRACTS.MarketSettings);
        config = getConfig(hre.network.name);

        await marketSettings_.setIntVals([encodeBytes32String("minKeeperFee")], [normalized(0)]);
        await marketSettings_.setIntVals([encodeBytes32String("maxFundingVelocity")], [0]);
        await marketSettings_.setIntVals([encodeBytes32String("maxFinancingFeeRate")], [0]);
        await USDC_.transfer(account1, usdcOf(10000000));
        await setPythAutoRefresh(hre);
    });

    it("deposit&remove at zero skew", async () => {
        // deposit
        USDC_ = USDC_.connect(account1);
        await USDC_.approve(market_, MaxUint256);
        const amount = usdcOf(100000);
        const minLp = 98000n * UNIT;
        await expect(liquidityManager_.addLiquidity(amount, minLp + 1n, account1, false)).to.be.revertedWith(
            "LiquidityManager: insufficient lp amount"
        );
        await expect(liquidityManager_.addLiquidity(amount, minLp, account1, false))
            .to.emit(liquidityManager_, "AddLiquidity")
            .withArgs(account1, amount, 0, normalized(98000), minLp);
        expect(await lpToken_.balanceOf(account1)).to.eq(minLp);
        expect(await lpToken_.totalSupply()).to.eq(minLp);
        expect(await USDC_.balanceOf(market_)).to.eq(amount);
        let globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.eq(normalized(98000));
        expect(globalStatus.netOpenInterest).to.eq(0);
        // remove
        await expect(liquidityManager_.removeLiquidity(minLp, amount + 1n, account1)).to.be.revertedWith(
            "LiquidityManager: insufficient amountOut"
        );
        const outUsdc = usdcOf(98000);
        await expect(liquidityManager_.removeLiquidity(minLp, outUsdc - outUsdc / 1000n, account1))
            .to.emit(liquidityManager_, "RemoveLiquidity")
            .withArgs(account1, minLp, normalized(98000), normalized(98000), normalized(98), outUsdc - outUsdc / 1000n);
        globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.eq((((amount - (outUsdc - outUsdc / 1000n)) * 98n) / 100n) * 10n ** 12n);
        expect(globalStatus.netOpenInterest).to.eq(0);
        expect(await lpToken_.balanceOf(account1)).to.eq(0);
    });

    it("deposit&remove at non-zero skew", async () => {
        // first deposit
        const amount = usdcOf(100000);
        const minLp = 98000n * UNIT;
        await liquidityManager_.addLiquidity(amount, minLp, account1, false);
        expect(await lpToken_.balanceOf(account1)).to.eq(minLp);

        // trade
        await positionManager_.depositMargin(USDC_, usdcOf(1500), ZeroHash);
        await positionManager_.submitOrder({
            token: WETH_,
            size: normalized(1),
            acceptablePrice: normalized(1550),
            keeperFee: usdcOf(0),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
            stopLoss: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        const oldGlobalStatus = await market_.globalStatus();
        const pythUpdateData = await getPythUpdateData(hre, { WETH: 1500 });
        const avgPrice = 1505621849515531495500n;
        const fee = avgPrice / 1000n;
        await expect(
            positionManager_.executeOrder(orderId, pythUpdateData.updateData, {
                value: pythUpdateData.fee,
            })
        )
            .to.emit(market_, "Traded")
            .withArgs(
                account1,
                WETH_,
                normalized(1),
                avgPrice, // avg price
                fee, // trading fee
                "0",
                orderId
            );
        const lpPosition = await perpTracker_.getLpPosition(WETH_);
        expect(lpPosition.longSize).to.eq(0);
        expect(lpPosition.shortSize).to.eq(normalized(-1));
        // second deposit
        let newLpNetValue =
            oldGlobalStatus[0] +
            avgPrice -
            1500n * UNIT +
            (((fee * 1000000n) / normalized("0.98")) * normalized("0.98")) / 1000000n;
        const mintAmount = ((await lpToken_.totalSupply()) * normalized(98000)) / newLpNetValue;
        await increaseNextBlockTimestamp(5); // 5s
        await expect(liquidityManager_.addLiquidity(amount, 0, account1, false))
            .to.emit(liquidityManager_, "AddLiquidity")
            .withArgs(account1, amount, newLpNetValue, normalized(98000), mintAmount);
        newLpNetValue += normalized(98000);
        // first remove
        await increaseNextBlockTimestamp(60); // 60s
        const totalSupply = await lpToken_.totalSupply();
        const toRemove = totalSupply - normalized(96000);
        const redeemValue = (newLpNetValue * toRemove) / totalSupply;
        const tradeAmount = (normalized(1) * redeemValue) / newLpNetValue;
        const priceOracle_ = await getTypedContract(hre, CONTRACTS.PriceOracle, account1);
        const oraclePrice = await priceOracle_.getPrice(WETH_);
        await perpTracker_.connect(deployer).setMarket(account1);
        const fillPrice = await perpTracker_.swapOnAMM.staticCall({
            token: WETH_,
            skew: normalized(1) - tradeAmount,
            size: tradeAmount,
            oraclePrice: oraclePrice,
            lpNetValue: newLpNetValue - redeemValue,
        });
        await perpTracker_.connect(deployer).setMarket(await market_.getAddress());
        let redeemFee = ((fillPrice - oraclePrice) * tradeAmount) / UNIT;
        redeemFee += ((redeemValue - redeemFee) * normalized("0.001")) / UNIT;
        const redeemed = ((redeemValue - redeemFee) * 1000000n) / normalized(1);
        await expect(liquidityManager_.removeLiquidity(toRemove, 0, account1))
            .to.emit(liquidityManager_, "RemoveLiquidity")
            .withArgs(account1, toRemove, newLpNetValue, redeemValue, redeemFee, redeemed);
        expect(await lpToken_.balanceOf(account1)).to.eq(normalized(96000));
        // second remove
        await increaseNextBlockTimestamp(5); // 5s
        await expect(liquidityManager_.removeLiquidity(normalized(96000), 0, account1)).to.be.revertedWith(
            "LiquidityManager: insufficient free lp"
        );
    });
});
