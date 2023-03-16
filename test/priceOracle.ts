import hre, { deployments } from "hardhat";
import { expect } from "chai";
import { CONTRACTS, getProxyContract } from "../src/utils/utils";
import {
    chainlinkAggregators,
    pythDataEncode,
    tokens,
} from "../src/utils/test_utils";
import { ethers } from "ethers";
import BigNumber from "bignumber.js";

describe("PriceOracle", () => {
    let priceOracle_: ethers.Contract;
    let account1: ethers.Signer;

    const chainlinkPrices: { [key: string]: number } = {
        Sequencer: 0,
        USDC: 1,
        WETH: 1500,
        WBTC: 20000,
    };

    const pythPrices: { [key: string]: number } = {
        USDC: 0.98,
        WETH: 1499,
        WBTC: 19999,
    };

    before(async () => {
        account1 = (await hre.ethers.getSigners())[1];
        await deployments.fixture();
        priceOracle_ = await getProxyContract(hre, CONTRACTS.PriceOracle);
        priceOracle_ = priceOracle_.connect(account1);
    });

    it("chainlink sequencer", async () => {
        const aggregator_ = await hre.ethers.getContract(
            "ChainlinkAggregatorSequencer",
            account1
        );
        await (await aggregator_.feed(1)).wait();
        await expect(
            priceOracle_.getLatestChainlinkPrice(
                (
                    await hre.ethers.getContract("USDC")
                ).address
            )
        ).to.be.revertedWith("PriceOracle: Sequencer is down");
    });

    it("chainlink feed price", async () => {
        for (const aggregator of chainlinkAggregators) {
            const name = `ChainlinkAggregator${aggregator.name}`;
            const aggregator_ = await hre.ethers.getContract(name, account1);
            const price = new BigNumber(chainlinkPrices[aggregator.name])
                .times(10 ** aggregator.decimals)
                .toString(10);
            await (await aggregator_.feed(price)).wait();
            if (aggregator.name !== "Sequencer") {
                const tokenAddress = (
                    await hre.ethers.getContract(aggregator.name)
                ).address;
                const answer = await priceOracle_.getLatestChainlinkPrice(
                    tokenAddress
                );
                expect(answer[0].eq(1)).to.be.eq(true);
                expect(
                    answer[1].eq(
                        new BigNumber(chainlinkPrices[aggregator.name])
                            .times(1e18)
                            .toString(10)
                    )
                ).to.be.eq(true);
            }
        }
    });

    it("pyth feed price", async () => {
        const pyth_ = await hre.ethers.getContract(
            CONTRACTS.Pyth.name,
            account1
        );
        for (const token of tokens) {
            const price = new BigNumber(pythPrices[token.symbol])
                .multipliedBy(10 ** -token.expo)
                .toString(10);
            const publishTime = Math.floor(Date.now() / 1000);
            const data = pythDataEncode(
                token.pythId,
                price,
                token.expo,
                publishTime
            );
            await expect(
                priceOracle_.updatePythPrice(await account1.getAddress(), [
                    data,
                ])
            ).to.be.revertedWith("PriceOracle: insufficient fee");
            const fee = await pyth_.getUpdateFee([data]);
            const balanceBefore = await hre.ethers.provider.getBalance(
                account1.getAddress()
            );
            const receipt = await (
                await priceOracle_.updatePythPrice(
                    await account1.getAddress(),
                    [data],
                    {
                        value: 10,
                    }
                )
            ).wait();
            const gasFee = receipt.gasUsed.mul(receipt.effectiveGasPrice);
            const balanceAfter = await hre.ethers.provider.getBalance(
                account1.getAddress()
            );
            // check fee cost
            expect(
                balanceBefore.sub(balanceAfter).eq(gasFee.add(fee))
            ).to.be.eq(true);
            // check answer
            const tokenAddress = (await hre.ethers.getContract(token.symbol))
                .address;
            const answer = await priceOracle_.getPythPrice(
                tokenAddress,
                100000
            );
            expect(answer[0]).to.be.eq(true);
            expect(answer[1].eq(publishTime)).to.be.eq(true);
            expect(
                answer[2].eq(
                    new BigNumber(1e18)
                        .times(pythPrices[token.symbol])
                        .toString(10)
                )
            ).to.be.eq(true);
        }
    });
});
