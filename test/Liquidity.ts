import hre, { deployments } from "hardhat";
import { expect } from "chai";
import {
    CONTRACTS,
    MAX_UINT256,
    UNIT,
    getProxyContract,
} from "../src/utils/utils";
import { setupPrices } from "../src/utils/test_utils";
import { ethers } from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { NetworkConfigs, getConfig } from "../src/config";

const chainlinkPrices: { [key: string]: number } = {
    Sequencer: 0,
    USDC: 0.998,
    WETH: 1500,
    WBTC: 20000,
};

const pythPrices: { [key: string]: number } = {
    USDC: 0.998,
    WETH: 1500,
    WBTC: 20000,
};

describe("Liquidity", () => {
    let account1: ethers.Signer;
    let deployer: ethers.Signer;
    let config: NetworkConfigs;
    let market_: ethers.Contract;
    let positionManager_: ethers.Contract;
    let liquidityManager_: ethers.Contract;
    let lpToken_: ethers.Contract;
    let WETH: string;
    let WBTC: string;
    let USDC_: ethers.Contract;

    before(async () => {
        deployer = (await hre.ethers.getSigners())[0];
        account1 = (await hre.ethers.getSigners())[1];
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH = (await hre.ethers.getContract("WETH")).address;
        WBTC = (await hre.ethers.getContract("WBTC")).address;
        USDC_ = await hre.ethers.getContract("USDC", deployer);
        market_ = await getProxyContract(hre, CONTRACTS.Market, account1);
        lpToken_ = await getProxyContract(hre, CONTRACTS.LPToken, account1);
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
        config = getConfig(hre.network.name);

        await (
            await USDC_.transfer(
                await account1.getAddress(),
                hre.ethers.BigNumber.from(10000000).mul(UNIT)
            )
        ).wait();
    });

    it("deposit&remove at zero skew", async () => {
        // deposit
        USDC_ = USDC_.connect(account1);
        await (await USDC_.approve(market_.address, MAX_UINT256)).wait();
        const amount = hre.ethers.BigNumber.from(100000).mul(UNIT);
        const minUsd = hre.ethers.BigNumber.from(99800).mul(UNIT);
        const minLp = hre.ethers.BigNumber.from(99800).mul(UNIT);
        await expect(
            liquidityManager_.addLiquidity(
                amount,
                minUsd.add(1),
                minLp,
                await account1.getAddress()
            )
        ).to.be.revertedWith("LiquidityManager: insufficient usd amount");
        await expect(
            liquidityManager_.addLiquidity(
                amount,
                minUsd,
                minLp.add(1),
                await account1.getAddress()
            )
        ).to.be.revertedWith("LiquidityManager: insufficient lp amount");
        await expect(
            liquidityManager_.addLiquidity(
                amount,
                minUsd,
                minLp,
                await account1.getAddress()
            )
        )
            .to.emit(liquidityManager_, "AddLiquidity")
            .withArgs(await account1.getAddress(), amount, 0, minUsd, minLp);
        expect(
            (await lpToken_.balanceOf(await account1.getAddress())).eq(minLp)
        ).to.be.eq(true);
        expect((await lpToken_.totalSupply()).eq(minLp)).to.be.eq(true);
        expect((await USDC_.balanceOf(market_.address)).eq(amount)).to.be.eq(
            true
        );
        expect((await market_.liquidityBalance()).eq(amount)).to.be.eq(true);
        expect(
            (
                await liquidityManager_.latestMint(await account1.getAddress())
            ).eq(await helpers.time.latest())
        ).to.be.eq(true);
        let globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue.eq(minUsd)).to.be.eq(true);
        expect(globalStatus.netOpenInterest.eq(0)).to.be.eq(true);
        // remove
        await expect(
            liquidityManager_.removeLiquidity(
                minLp,
                amount,
                await account1.getAddress()
            )
        ).to.be.revertedWith("LiquidityManager: remove is in cooldown");
        await helpers.time.increase(
            config.marketGeneralConfig.liquidityRemoveCooldown
        );
        await expect(
            liquidityManager_.removeLiquidity(
                minLp,
                amount.add(1),
                await account1.getAddress()
            )
        ).to.be.revertedWith("LiquidityManager: insufficient amountOut");
        await expect(
            liquidityManager_.removeLiquidity(
                minLp,
                amount,
                await account1.getAddress()
            )
        )
            .to.emit(liquidityManager_, "RemoveLiquidity")
            .withArgs(
                await account1.getAddress(),
                minLp,
                minUsd,
                minUsd,
                amount
            );
        globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue.eq(0)).to.be.eq(true);
        expect(globalStatus.netOpenInterest.eq(0)).to.be.eq(true);
    });

    it("deposit&remove at non-zero skew", async () => {
        // first deposit
        const amount = hre.ethers.BigNumber.from(100000).mul(UNIT);
        const minUsd = hre.ethers.BigNumber.from(99800).mul(UNIT);
        const minLp = hre.ethers.BigNumber.from(99800).mul(UNIT);
        await (
            await liquidityManager_.addLiquidity(
                amount,
                minUsd,
                minLp,
                await account1.getAddress()
            )
        ).wait();
        // trade
    });
});
