import hre, { deployments } from "hardhat";
import { expect } from "chai";
import { CONTRACTS, MAX_UINT256, UNIT, getProxyContract, normalized, usdcOf } from "../src/utils/utils";
import {
    getPythUpdateData,
    increaseNextBlockTimestamp,
    setPythAutoRefresh,
    setupPrices,
} from "../src/utils/test_utils";
import { ethers } from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { NetworkConfigs, getConfig } from "../src/config";

const chainlinkPrices: { [key: string]: number } = {
    Sequencer: 0,
    USDC: 0.98,
    WETH: 1500,
    WBTC: 20000,
};

const pythPrices: { [key: string]: number } = {
    USDC: 0.98,
    WETH: 1500,
    WBTC: 20000,
};

describe("Liquidity", () => {
    let account1: ethers.Signer;
    let deployer: ethers.Signer;
    let config: NetworkConfigs;
    let market_: ethers.Contract;
    let perpTracker_: ethers.Contract;
    let positionManager_: ethers.Contract;
    let liquidityManager_: ethers.Contract;
    let lpToken_: ethers.Contract;
    let WETH: string;
    let USDC_: ethers.Contract;
    let marketSettings_: ethers.Contract;

    before(async () => {
        deployer = (await hre.ethers.getSigners())[0];
        account1 = (await hre.ethers.getSigners())[1];
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH = await (await hre.ethers.getContract("WETH")).getAddress();
        USDC_ = await hre.ethers.getContract("USDC", deployer);
        market_ = await getProxyContract(hre, CONTRACTS.Market, account1);
        lpToken_ = await getProxyContract(hre, CONTRACTS.LPToken, account1);
        perpTracker_ = await getProxyContract(hre, CONTRACTS.PerpTracker, account1);
        liquidityManager_ = await getProxyContract(hre, CONTRACTS.LiquidityManager, account1);
        positionManager_ = await getProxyContract(hre, CONTRACTS.PositionManager, account1);
        marketSettings_ = await getProxyContract(hre, CONTRACTS.MarketSettings, deployer);
        config = getConfig(hre.network.name);

        await (
            await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("minKeeperFee")], [normalized(0)])
        ).wait();
        await (await USDC_.transfer(await account1.getAddress(), usdcOf(10000000))).wait();
        await setPythAutoRefresh(hre);
    });

    it("deposit&remove at zero skew", async () => {
        // deposit
        USDC_ = USDC_.connect(account1);
        await (await USDC_.approve(await market_.getAddress(), MAX_UINT256)).wait();
        const amount = BigInt(usdcOf(100000));
        const minLp = 98000n * UNIT;
        await expect(
            liquidityManager_.addLiquidity(amount, minLp + 1n, await account1.getAddress(), false)
        ).to.be.revertedWith("LiquidityManager: insufficient lp amount");
        await expect(liquidityManager_.addLiquidity(amount, minLp, await account1.getAddress(), false))
            .to.emit(liquidityManager_, "AddLiquidity")
            .withArgs(await account1.getAddress(), amount, 0, normalized(98000), minLp);
        expect(await lpToken_.balanceOf(await account1.getAddress())).to.deep.eq(minLp);
        expect(await lpToken_.totalSupply()).to.deep.eq(minLp);
        expect(await USDC_.balanceOf(await market_.getAddress())).to.deep.eq(amount);
        let globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq(normalized(98000));
        expect(globalStatus.netOpenInterest).to.deep.eq(0);
        // remove
        await expect(
            liquidityManager_.removeLiquidity(minLp, amount + 1n, await account1.getAddress())
        ).to.be.revertedWith("LiquidityManager: insufficient amountOut");
        const outUsdc = BigInt(usdcOf(98000));
        await expect(liquidityManager_.removeLiquidity(minLp, outUsdc - outUsdc / 1000n, await account1.getAddress()))
            .to.emit(liquidityManager_, "RemoveLiquidity")
            .withArgs(
                await account1.getAddress(),
                minLp,
                normalized(98000),
                normalized(98000),
                normalized(98),
                outUsdc - outUsdc / 1000n
            );
        globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq(
            (((amount - (outUsdc - outUsdc / 1000n)) * 98n) / 100n) * 10n ** 12n
        );
        expect(globalStatus.netOpenInterest).to.deep.eq(0);
        expect(await lpToken_.balanceOf(await account1.getAddress())).to.deep.eq(0);
    });

    it("deposit&remove at non-zero skew", async () => {
        // first deposit
        const amount = BigInt(usdcOf(100000));
        const minLp = 98000n * UNIT;
        await (await liquidityManager_.addLiquidity(amount, minLp, await account1.getAddress(), false)).wait();
        expect(await lpToken_.balanceOf(await account1.getAddress())).to.deep.eq(minLp);

        // trade
        await (
            await positionManager_.depositMargin(await USDC_.getAddress(), usdcOf(1500), hre.ethers.ZeroHash)
        ).wait();
        await (
            await positionManager_.submitOrder([
                WETH,
                normalized(1),
                normalized(1550),
                usdcOf(0),
                (await helpers.time.latest()) + 100,
                false,
            ])
        ).wait();
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
                await account1.getAddress(),
                WETH,
                normalized(1),
                "1507127471365047026995", // avg price
                "1505621849515531495", // trading fee
                "0",
                orderId
            );
        const lpPosition = await perpTracker_.getLpPosition(WETH);
        expect(lpPosition.longSize).to.deep.eq(0);
        expect(lpPosition.shortSize).to.deep.eq(normalized(-1));
        // second deposit
        await increaseNextBlockTimestamp(5); // 5s
        await expect(liquidityManager_.addLiquidity(amount, 0, await account1.getAddress(), false))
            .to.emit(liquidityManager_, "AddLiquidity")
            .withArgs(
                await account1.getAddress(),
                amount,
                "100063167482660718548495",
                normalized(98000),
                "95979372246678213029024"
            );
        // first remove
        await increaseNextBlockTimestamp(5); // 5s
        expect(await lpToken_.totalSupply()).to.deep.eq("193979372246678213029024");
        await expect(liquidityManager_.removeLiquidity("97947435790888919009027", 0, await account1.getAddress()))
            .to.emit(liquidityManager_, "RemoveLiquidity")
            .withArgs(
                await account1.getAddress(),
                "97947435790888919009027",
                "198063167516547733117495",
                "100009496670589133786639",
                "104335840814250165629",
                "99905160829"
            );
        expect(await lpToken_.totalSupply()).to.deep.eq("96031936455789294019997");
        expect(await lpToken_.balanceOf(await account1.getAddress())).to.deep.eq("96031936455789294019997");
        // second remove
        await increaseNextBlockTimestamp(5); // 5s
        await expect(
            liquidityManager_.removeLiquidity(normalized(96000), 0, await account1.getAddress())
        ).to.be.revertedWith("LiquidityManager: insufficient free lp");
    });
});
