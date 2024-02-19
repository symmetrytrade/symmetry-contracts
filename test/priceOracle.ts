import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { Signer } from "ethers";
import hre, { deployments } from "hardhat";
import {
    chainlinkAggregators,
    latestBlockTimestamp,
    pythDataEncode,
    tokens,
    updateChainlinkPrice,
} from "../src/utils/test_utils";
import { CONTRACTS, getTypedContract, normalized, tokenOf, UNIT } from "../src/utils/utils";
import { PriceOracle } from "../typechain-types";

const chainlinkPrices: { [key: string]: number } = {
    Sequencer: 0,
    USDC: 1,
    WETH: 1500,
    WBTC: 20000,
};

const pythPrices: { [key: string]: string | number } = {
    USDC: "0.998",
    WETH: 1499,
    WBTC: 19999,
};

describe("PriceOracle", () => {
    let priceOracle_: PriceOracle;
    let account1: Signer;

    before(async () => {
        account1 = (await hre.ethers.getSigners())[1];
        await deployments.fixture();
        priceOracle_ = await getTypedContract(hre, CONTRACTS.PriceOracle, account1);
    });

    it("chainlink sequencer", async () => {
        const aggregator_ = await getTypedContract(hre, CONTRACTS.ChainlinkAggregatorSequencer, account1);
        await aggregator_.feed(1, await helpers.time.latest());
        await expect(
            priceOracle_.getLatestChainlinkPrice(await getTypedContract(hre, CONTRACTS.USDC))
        ).to.be.revertedWith("PriceOracle: Sequencer is down");
    });

    it("chainlink feed price", async () => {
        for (const aggregator of chainlinkAggregators) {
            await updateChainlinkPrice(hre, aggregator.name, chainlinkPrices[aggregator.name], account1);
            if (aggregator.name !== "Sequencer") {
                const token_ = await hre.ethers.getContract(aggregator.name);
                const answer = await priceOracle_.getLatestChainlinkPrice(token_);
                expect(answer[0]).to.eq(1);
                expect(answer[2]).to.eq(BigInt(chainlinkPrices[aggregator.name]) * UNIT);
            }
        }
    });

    it("pyth feed price", async () => {
        for (const token of tokens) {
            const price = tokenOf(pythPrices[token.symbol], -token.expo);
            const publishTime = await latestBlockTimestamp(hre);
            const data = pythDataEncode(token.pythId, price, token.expo, publishTime);
            await expect(priceOracle_.updatePythPrice([data])).to.be.revertedWith("PriceOracle: insufficient fee");
            const balanceBefore = await hre.ethers.provider.getBalance(account1);
            const receipt = await (
                await priceOracle_.updatePythPrice([data], {
                    value: 10,
                })
            ).wait();
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const gasFee = receipt!.gasUsed * receipt!.gasPrice;
            const balanceAfter = await hre.ethers.provider.getBalance(account1);
            // check fee cost
            expect(balanceBefore - balanceAfter).to.eq(gasFee + 10n);
            // check answer
            const token_ = await hre.ethers.getContract(token.symbol);
            const answer = await priceOracle_.getPythPrice(token_);
            expect(answer[0]).to.eq(publishTime);
            expect(answer[1]).to.eq(normalized(pythPrices[token.symbol]));
        }
    });
});
