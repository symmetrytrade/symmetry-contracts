import hre, { deployments } from "hardhat";
import { expect } from "chai";
import { CONTRACTS, UNIT, getProxyContract } from "../src/utils/utils";
import {
    chainlinkAggregators,
    latestBlockTimestamp,
    pythDataEncode,
    tokens,
    updateChainlinkPrice,
} from "../src/utils/test_utils";
import { ethers } from "ethers";
import BigNumber from "bignumber.js";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

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

describe("PriceOracle", () => {
    let priceOracle_: ethers.Contract;
    let account1: ethers.Signer;

    before(async () => {
        account1 = (await hre.ethers.getSigners())[1];
        await deployments.fixture();
        priceOracle_ = await getProxyContract(hre, CONTRACTS.PriceOracle, account1);
    });

    it("chainlink sequencer", async () => {
        const aggregator_ = await hre.ethers.getContract("ChainlinkAggregatorSequencer", account1);
        await (await aggregator_.feed(1, helpers.time.latest())).wait();
        await expect(
            priceOracle_.getLatestChainlinkPrice(await (await hre.ethers.getContract("USDC")).getAddress())
        ).to.be.revertedWith("PriceOracle: Sequencer is down");
    });

    it("chainlink feed price", async () => {
        for (const aggregator of chainlinkAggregators) {
            await updateChainlinkPrice(hre, aggregator.name, chainlinkPrices[aggregator.name], account1);
            if (aggregator.name !== "Sequencer") {
                const tokenAddress = await (await hre.ethers.getContract(aggregator.name)).getAddress();
                const answer = await priceOracle_.getLatestChainlinkPrice(tokenAddress);
                expect(answer[0]).to.deep.eq(1);
                expect(answer[2]).to.deep.eq(BigInt(chainlinkPrices[aggregator.name]) * UNIT);
            }
        }
    });

    it("pyth feed price", async () => {
        for (const token of tokens) {
            const price = new BigNumber(pythPrices[token.symbol]).multipliedBy(10 ** -token.expo).toString(10);
            const publishTime = await latestBlockTimestamp(hre);
            const data = pythDataEncode(token.pythId, price, token.expo, publishTime);
            await expect(priceOracle_.updatePythPrice([data])).to.be.revertedWith("PriceOracle: insufficient fee");
            const balanceBefore = await hre.ethers.provider.getBalance(account1.getAddress());
            const receipt = await (
                await priceOracle_.updatePythPrice([data], {
                    value: 10,
                })
            ).wait();
            const gasFee = receipt.gasUsed * receipt.effectiveGasPrice;
            const balanceAfter = await hre.ethers.provider.getBalance(account1.getAddress());
            // check fee cost
            expect(balanceBefore - balanceAfter).to.deep.eq(gasFee + 10n);
            // check answer
            const tokenAddress = await (await hre.ethers.getContract(token.symbol)).getAddress();
            const answer = await priceOracle_.getPythPrice(tokenAddress);
            expect(answer[0]).to.deep.eq(publishTime);
            expect(answer[1]).to.deep.eq(new BigNumber(1e18).times(pythPrices[token.symbol]).toString(10));
        }
    });
});
