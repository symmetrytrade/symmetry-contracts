import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { ethers } from "ethers";
import hardhat from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ChainlinkMock } from "../../typechain-types";
import { CONTRACTS, getTypedContract, tokenOf } from "./utils";

const abiCoder = hardhat.ethers.AbiCoder.defaultAbiCoder();

export const WEEK = 3600n * 24n * 7n;
export const DAY = 3600n * 24n;
export const HOUR = 3600n;

export function startOfDay(t: ethers.BigNumberish) {
    return (BigInt(t) / DAY) * DAY;
}

export function startOfWeek(t: ethers.BigNumberish) {
    return (BigInt(t) / WEEK) * WEEK;
}

export async function increaseNextBlockTimestamp(interval: ethers.BigNumberish) {
    const evmTime = BigInt(await helpers.time.latest());
    await helpers.time.setNextBlockTimestamp(evmTime + BigInt(interval));
}

export function printValues(name: string, e: object) {
    console.log(`\n==== ${name} begin ====`);
    for (const [k, v] of Object.entries(e)) {
        if (k >= "0" && k <= "9") continue;
        console.log(`${k}: ${String(v)}`);
    }
    console.log(`==== ${name} end  ====\n`);
}

export async function latestBlockTimestamp(hre: HardhatRuntimeEnvironment) {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return (await hre.ethers.provider.getBlock(await hre.ethers.provider.getBlockNumber()))!.timestamp;
}

export function pythDataEncode(id: string, price: ethers.BigNumberish, expo: number, publishTime: number) {
    return abiCoder.encode(["bytes32", "int64", "int32", "uint256"], [id, price, expo, publishTime]);
}

export const chainlinkAggregators = [
    { name: "Sequencer", decimals: 0 },
    { name: "USDC", decimals: 6 },
    { name: "WETH", decimals: 20 },
    { name: "WBTC", decimals: 8 },
];

export const tokens = [
    {
        name: "USD Coin",
        symbol: "USDC",
        pythId: hardhat.ethers.encodeBytes32String("USDC"),
        expo: -6,
    },
    {
        name: "Wrapped Ether",
        symbol: "WETH",
        pythId: hardhat.ethers.encodeBytes32String("WETH"),
        expo: -10,
    },
    {
        name: "Wrapped Bitcoin",
        symbol: "WBTC",
        pythId: hardhat.ethers.encodeBytes32String("WBTC"),
        expo: -8,
    },
] as const;

export function getPythInfo(symbol: string) {
    for (const token of tokens) {
        if (token.symbol === symbol) return token;
    }
    throw new Error("token not found");
}

export async function updateChainlinkPrice(
    hre: HardhatRuntimeEnvironment,
    symbol: string,
    price: string | number,
    sender: ethers.Signer
) {
    const name = `ChainlinkAggregator${symbol}`;
    const aggregator_: ChainlinkMock = await hre.ethers.getContract(name, sender);
    const decimals = Number(await aggregator_.decimals());
    const updateTime = await helpers.time.latest();
    await increaseNextBlockTimestamp(1);
    await (await aggregator_.feed(tokenOf(price, decimals), updateTime)).wait();
}

export async function getPythUpdateData(
    hre: HardhatRuntimeEnvironment,
    pythPrices: { [key: string]: string | number }
) {
    const updateData = [];
    for (const [token, value] of Object.entries(pythPrices)) {
        const info = getPythInfo(token);
        const price = tokenOf(value, -info.expo);
        const publishTime = await helpers.time.latest();
        const data = pythDataEncode(info.pythId, price, info.expo, publishTime);
        updateData.push(data);
    }
    const pyth_ = await getTypedContract(hre, CONTRACTS.Pyth);
    const fee = await pyth_.getUpdateFee(updateData);
    return {
        updateData: updateData,
        fee: fee,
    };
}

export async function setPythAutoRefresh(hre: HardhatRuntimeEnvironment) {
    const pyth_ = await getTypedContract(hre, CONTRACTS.Pyth);
    await (await pyth_.setAutoRefresh(true)).wait();
}

export async function setupPrices(
    hre: HardhatRuntimeEnvironment,
    chainlinkPrices: { [key: string]: string | number },
    pythPrices: { [key: string]: string | number },
    sender: ethers.Signer
) {
    for (const [key, value] of Object.entries(chainlinkPrices)) {
        await updateChainlinkPrice(hre, key, value, sender);
    }
    const pyth_ = await getTypedContract(hre, CONTRACTS.Pyth, sender);
    const priceOracle_ = await getTypedContract(hre, CONTRACTS.PriceOracle, sender);
    for (const [token, value] of Object.entries(pythPrices)) {
        const info = getPythInfo(token);
        const price = tokenOf(value, -info.expo);
        const publishTime = await helpers.time.latest();
        const data = pythDataEncode(info.pythId, price, info.expo, publishTime);
        const fee = await pyth_.getUpdateFee([data]);
        await increaseNextBlockTimestamp(1);
        await (
            await priceOracle_.updatePythPrice([data], {
                value: fee,
            })
        ).wait();
    }
}
