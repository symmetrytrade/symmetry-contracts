import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "ethers";
import hre, { deployments } from "hardhat";
import { getConfig, NetworkConfigs } from "../src/config";
import {
    getPythUpdateData,
    increaseNextBlockTimestamp,
    setPythAutoRefresh,
    setupPrices,
} from "../src/utils/test_utils";
import { CONTRACTS, getTypedContract, MAX_UINT256, normalized, UNIT, usdcOf } from "../src/utils/utils";
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
    let account1: ethers.Signer;
    let config: NetworkConfigs;
    let market_: Market;
    let perpTracker_: PerpTracker;
    let positionManager_: PositionManager;
    let liquidityManager_: LiquidityManager;
    let lpToken_: LPToken;
    let WETH: string;
    let USDC_: FaucetToken;
    let marketSettings_: MarketSettings;

    before(async () => {
        account1 = (await hre.ethers.getSigners())[1];
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH = await (await getTypedContract(hre, CONTRACTS.WETH)).getAddress();
        USDC_ = await getTypedContract(hre, CONTRACTS.USDC);
        market_ = await getTypedContract(hre, CONTRACTS.Market, account1);
        lpToken_ = await getTypedContract(hre, CONTRACTS.LPToken, account1);
        perpTracker_ = await getTypedContract(hre, CONTRACTS.PerpTracker, account1);
        liquidityManager_ = await getTypedContract(hre, CONTRACTS.LiquidityManager, account1);
        positionManager_ = await getTypedContract(hre, CONTRACTS.PositionManager, account1);
        marketSettings_ = await getTypedContract(hre, CONTRACTS.MarketSettings);
        config = getConfig(hre.network.name);

        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("minKeeperFee")], [normalized(0)]);
        await USDC_.transfer(account1, usdcOf(10000000));
        await setPythAutoRefresh(hre);
    });

    it("deposit&remove at zero skew", async () => {
        // deposit
        USDC_ = USDC_.connect(account1);
        await USDC_.approve(market_, MAX_UINT256);
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
        await positionManager_.depositMargin(USDC_, usdcOf(1500), hre.ethers.ZeroHash);
        await positionManager_.submitOrder({
            token: WETH,
            size: normalized(1),
            acceptablePrice: normalized(1550),
            keeperFee: usdcOf(0),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        const pythUpdateData = await getPythUpdateData(hre, { WETH: 1500 });
        await expect(
            positionManager_.executeOrder(orderId, pythUpdateData.updateData, {
                value: pythUpdateData.fee,
            })
        )
            .to.emit(market_, "Traded")
            .withArgs(
                account1,
                WETH,
                normalized(1),
                "1507127471365047026995", // avg price
                "1505621849515531495", // trading fee
                "0",
                orderId
            );
        const lpPosition = await perpTracker_.getLpPosition(WETH);
        expect(lpPosition.longSize).to.eq(0);
        expect(lpPosition.shortSize).to.eq(normalized(-1));
        // second deposit
        await increaseNextBlockTimestamp(5); // 5s
        await expect(liquidityManager_.addLiquidity(amount, 0, account1, false))
            .to.emit(liquidityManager_, "AddLiquidity")
            .withArgs(account1, amount, "100063167482660718548495", normalized(98000), "95979372246678213029024");
        // first remove
        await increaseNextBlockTimestamp(5); // 5s
        expect(await lpToken_.totalSupply()).to.eq("193979372246678213029024");
        await expect(liquidityManager_.removeLiquidity("97947435790888919009027", 0, account1))
            .to.emit(liquidityManager_, "RemoveLiquidity")
            .withArgs(
                account1,
                "97947435790888919009027",
                "198063167516547733117495",
                "100009496670589133786639",
                "104335840814250165629",
                "99905160829"
            );
        expect(await lpToken_.totalSupply()).to.eq("96031936455789294019997");
        expect(await lpToken_.balanceOf(account1)).to.eq("96031936455789294019997");
        // second remove
        await increaseNextBlockTimestamp(5); // 5s
        await expect(liquidityManager_.removeLiquidity(normalized(96000), 0, account1)).to.be.revertedWith(
            "LiquidityManager: insufficient free lp"
        );
    });
});
