import hre, { deployments } from "hardhat";
import { expect } from "chai";
import {
    CONTRACTS,
    MAX_UINT256,
    UNIT,
    getProxyContract,
} from "../src/utils/utils";
import { getPythUpdateData, setupPrices } from "../src/utils/test_utils";
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
    WETH: 1499,
    WBTC: 20000,
};

describe("Market", () => {
    let account1: ethers.Signer;
    let deployer: ethers.Signer;
    let config: NetworkConfigs;
    let market_: ethers.Contract;
    let perpTracker_: ethers.Contract;
    let priceOracle_: ethers.Contract;
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
        perpTracker_ = await getProxyContract(
            hre,
            CONTRACTS.PerpTracker,
            account1
        );
        priceOracle_ = await getProxyContract(
            hre,
            CONTRACTS.PriceOracle,
            account1
        );
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
                hre.ethers.BigNumber.from(100000000).mul(UNIT)
            )
        ).wait();

        // add liquidity
        USDC_ = USDC_.connect(account1);
        await (await USDC_.approve(market_.address, MAX_UINT256)).wait();
        const amount = hre.ethers.BigNumber.from(1000000).mul(UNIT);
        const minUsd = hre.ethers.BigNumber.from(980000).mul(UNIT);
        const minLp = hre.ethers.BigNumber.from(980000).mul(UNIT);
        await (
            await liquidityManager_.addLiquidity(
                amount,
                minUsd,
                minLp,
                await account1.getAddress()
            )
        ).wait();
    });

    it("getPrice", async () => {
        let price = await priceOracle_.getPrice(WETH, false);
        expect(price.div(UNIT).eq(1499)).to.be.eq(true);

        await helpers.time.increase(config.marketGeneralConfig.pythMaxAge);

        price = await priceOracle_.getPrice(WETH, false);
        expect(price.div(UNIT).eq(1499)).to.be.eq(true);

        await setupPrices(hre, { WETH: 1500 }, {}, account1);
        price = await priceOracle_.getPrice(WETH, false);
        expect(price.div(UNIT).eq(1500)).to.be.eq(true);

        await expect(priceOracle_.getPrice(WETH, true)).to.be.revertedWith(
            "PriceOracle: pyth price too stale"
        );

        await setupPrices(hre, {}, { WETH: 1300 }, account1);
        await expect(priceOracle_.getPrice(WETH, false)).to.be.revertedWith(
            "PriceOracle: oracle price divergence too large"
        );

        await setupPrices(hre, {}, { WETH: 1600 }, account1);
        await expect(priceOracle_.getPrice(WETH, false)).to.be.revertedWith(
            "PriceOracle: oracle price divergence too large"
        );

        await setupPrices(hre, {}, { WETH: 1500 }, account1);
    });

    it("tokenToUsd", async () => {
        let usdAmount = await market_.tokenToUsd(
            WETH,
            hre.ethers.BigNumber.from(2).mul(UNIT),
            false
        );
        expect(usdAmount.div(UNIT).eq(3000)).to.be.eq(true);
        usdAmount = await market_.tokenToUsd(
            WETH,
            hre.ethers.BigNumber.from(-5).mul(UNIT),
            false
        );
        expect(usdAmount.div(UNIT).eq(-7500)).to.be.eq(true);
    });

    it("usdToToken", async () => {
        let tokenAmount = await market_.usdToToken(
            WETH,
            hre.ethers.BigNumber.from(3000).mul(UNIT),
            false
        );
        expect(tokenAmount.div(UNIT).eq(2)).to.be.eq(true);
        tokenAmount = await market_.usdToToken(
            WETH,
            hre.ethers.BigNumber.from(-7500).mul(UNIT),
            false
        );
        expect(tokenAmount.div(UNIT).eq(-5)).to.be.eq(true);
    });

    it("trade", async () => {
        await (
            await positionManager_.depositMargin(
                hre.ethers.BigNumber.from(1500).mul(UNIT)
            )
        ).wait();

        await (
            await positionManager_.submitOrder(
                WETH,
                hre.ethers.BigNumber.from(10).mul(UNIT),
                hre.ethers.BigNumber.from(1550).mul(UNIT),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        const orderId = (await positionManager_.orderCnt()).sub(1);

        await helpers.time.increase(config.marketGeneralConfig.minOrderDelay);

        const pythUpdateData = await getPythUpdateData(hre, { WETH: 1500 });
        await (
            await positionManager_.executeOrder(
                orderId,
                pythUpdateData.updateData,
                { value: pythUpdateData.fee }
            )
        ).wait();
        const position = await perpTracker_.getPosition(
            await account1.getAddress(),
            WETH
        );
        /*
        console.log("Position:");
        for (const [k, v] of Object.entries(position)) {
            console.log(`${k}: ${v.toString()}`);
        }
        const status = await market_.accountMarginStatus(
            await account1.getAddress()
        );
        console.log("Margin Status:");
        for (const [k, v] of Object.entries(status)) {
            console.log(`${k}: ${v.toString()}`);
        }
        console.log("global position:");
        const globalPosition = await perpTracker_.getGlobalPosition(WETH);
        for (const [k, v] of Object.entries(globalPosition)) {
            console.log(`${k}: ${v.toString()}`);
        }
        console.log("global status:");
        const globalStatus = await market_.globalStatus();
        for (const [k, v] of Object.entries(globalStatus)) {
            console.log(`${k}: ${v.toString()}`);
        }*/
    });
});
