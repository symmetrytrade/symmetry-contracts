import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { encodeBytes32String, MaxUint256, Signer } from "ethers";
import hre, { deployments } from "hardhat";
import { getConfig, NetworkConfigs } from "../src/config";
import { increaseNextBlockTimestamp, setPythAutoRefresh, setupPrices } from "../src/utils/test_utils";
import { CONTRACTS, getTypedContract, normalized, UNIT, usdcOf } from "../src/utils/utils";
import { FaucetToken, LiquidityManager, Market, MarketSettings, PriceOracle } from "../typechain-types";

const chainlinkPrices: { [key: string]: string | number } = {
    Sequencer: 0,
    USDC: "0.98",
    WETH: 1500,
    WBTC: 20000,
};

const pythPrices: { [key: string]: string | number } = {
    USDC: "0.98",
    WETH: 1499,
    WBTC: 20000,
};

describe("Market", () => {
    let account1: Signer;
    let config: NetworkConfigs;
    let market_: Market;
    let priceOracle_: PriceOracle;
    let liquidityManager_: LiquidityManager;
    let marketSettings_: MarketSettings;
    let WETH_: FaucetToken;
    let USDC_: FaucetToken;

    before(async () => {
        account1 = (await hre.ethers.getSigners())[1];
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH_ = await getTypedContract(hre, CONTRACTS.WETH);
        USDC_ = await getTypedContract(hre, CONTRACTS.USDC);
        market_ = await getTypedContract(hre, CONTRACTS.Market, account1);
        priceOracle_ = await getTypedContract(hre, CONTRACTS.PriceOracle, account1);
        marketSettings_ = await getTypedContract(hre, CONTRACTS.MarketSettings);
        liquidityManager_ = await getTypedContract(hre, CONTRACTS.LiquidityManager, account1);
        config = getConfig(hre.network.name);

        await USDC_.transfer(account1, usdcOf(100000000));

        // add liquidity
        USDC_ = USDC_.connect(account1);
        await USDC_.approve(market_, MaxUint256);
        const amount = usdcOf(1000000);
        const minLp = 980000n * UNIT;
        await liquidityManager_.addLiquidity(amount, minLp, account1, false);

        await marketSettings_.setIntVals([encodeBytes32String("minKeeperFee")], [normalized(0)]);
        // set perp taker fee to 0.1%, maker fee to 0
        await marketSettings_.setIntVals([encodeBytes32String("perpTakerFee")], [normalized("0.001")]);
        await marketSettings_.setIntVals([encodeBytes32String("perpMakerFee")], [0]);
    });

    it("getPrice", async () => {
        let price = await priceOracle_.getPrice(WETH_);
        expect(price / UNIT).to.eq(1499);

        await increaseNextBlockTimestamp(config.marketGeneralConfig.pythMaxAge);
        await helpers.mine();

        price = await priceOracle_.getPrice(WETH_);
        expect(price / UNIT).to.eq(1499);

        await setupPrices(hre, { WETH: 1500 }, {}, account1);
        price = await priceOracle_.getPrice(WETH_);
        expect(price / UNIT).to.eq(1500);

        await expect(priceOracle_.getOffchainPrice(WETH_, 0)).to.be.revertedWith("PriceOracle: pyth price too stale");

        await setupPrices(hre, {}, { WETH: 1300 }, account1);
        await expect(priceOracle_.getPrice(WETH_)).to.be.revertedWith("PriceOracle: oracle price divergence too large");

        await setupPrices(hre, {}, { WETH: 1600 }, account1);
        await expect(priceOracle_.getPrice(WETH_)).to.be.revertedWith("PriceOracle: oracle price divergence too large");

        await setupPrices(hre, {}, { WETH: 1500 }, account1);

        // for convenience of following test, set divergence to 200%
        await marketSettings_.setIntVals([encodeBytes32String("maxPriceDivergence")], [normalized(2)]);
        await setPythAutoRefresh(hre);
    });

    it("tokenToUsd", async () => {
        let usdAmount = await market_.tokenToUsd(WETH_, 2n * UNIT);
        expect(usdAmount / UNIT).to.eq(3000);
        usdAmount = await market_.tokenToUsd(WETH_, -5n * UNIT);
        expect(usdAmount / UNIT).to.eq(-7500);
    });

    it("usdToToken", async () => {
        let tokenAmount = await market_.usdToToken(WETH_, 3000n * UNIT);
        expect(tokenAmount / UNIT).to.eq(2);
        tokenAmount = await market_.usdToToken(WETH_, -7500n * UNIT);
        expect(tokenAmount / UNIT).to.eq(-5);
    });
});
