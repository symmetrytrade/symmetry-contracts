import hre, { deployments } from "hardhat";
import { expect } from "chai";
import { CONTRACTS, UNIT, getProxyContract } from "../src/utils/utils";
import { setupPrices } from "../src/utils/test_utils";
import { ethers } from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { NetworkConfigs, getConfig } from "../src/config";

const chainlinkPrices: { [key: string]: number } = {
    Sequencer: 0,
    USDC: 1,
    WETH: 1500,
    WBTC: 20000,
};

const pythPrices: { [key: string]: number } = {
    USDC: 0.998,
    WETH: 1499,
    WBTC: 19999,
};

describe("Market", () => {
    let account1: ethers.Signer;
    let config: NetworkConfigs;
    let market_: ethers.Contract;
    let WETH: string;

    before(async () => {
        account1 = (await hre.ethers.getSigners())[1];
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH = (await hre.ethers.getContract("WETH")).address;
        market_ = await getProxyContract(hre, CONTRACTS.Market, account1);
        config = getConfig(hre.network.name);
    });

    it("getPrice", async () => {
        let price = await market_.getPrice(WETH, false);
        expect(price.div(UNIT).eq(1499)).to.be.eq(true);

        await helpers.time.increase(config.marketGeneralConfig.pythMaxAge);

        price = await market_.getPrice(WETH, false);
        expect(price.div(UNIT).eq(1499)).to.be.eq(true);

        await setupPrices(hre, { WETH: 1500 }, {}, account1);
        price = await market_.getPrice(WETH, false);
        expect(price.div(UNIT).eq(1500)).to.be.eq(true);

        await expect(market_.getPrice(WETH, true)).to.be.revertedWith(
            "Market: pyth price too stale"
        );

        await setupPrices(hre, {}, { WETH: 1300 }, account1);
        await expect(market_.getPrice(WETH, false)).to.be.revertedWith(
            "Market: oracle price divergence too large"
        );

        await setupPrices(hre, {}, { WETH: 1600 }, account1);
        await expect(market_.getPrice(WETH, false)).to.be.revertedWith(
            "Market: oracle price divergence too large"
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
});
