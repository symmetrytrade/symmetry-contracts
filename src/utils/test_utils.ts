import BigNumber from "bignumber.js";
import hardhat from "hardhat";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { ethers } from "ethers";
import { CONTRACTS, getProxyContract } from "./utils";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

const abiCoder = new hardhat.ethers.utils.AbiCoder();

export const WEEK = 3600 * 24 * 7;
export const DAY = 3600 * 24;
export const HOUR = 3600;

export function startOfDay(t: number) {
    return Math.floor(t / DAY) * DAY;
}

export function startOfWeek(t: number) {
    return Math.floor(t / WEEK) * WEEK;
}

export async function increaseNextBlockTimestamp(interval: number) {
    const evmTime = await helpers.time.latest();
    await helpers.time.setNextBlockTimestamp(evmTime + interval);
}

export function printValues(name: string, e: object) {
    console.log(`\n==== ${name} begin ====`);
    for (const [k, v] of Object.entries(e)) {
        if (k >= "0" && k <= "9") continue;
        console.log(`${k}: ${v.toString()}`);
    }
    console.log(`==== ${name} end  ====\n`);
}

export async function latestBlockTimestamp(hre: HardhatRuntimeEnvironment) {
    return (await hre.ethers.provider.getBlock(await hre.ethers.provider.getBlockNumber())).timestamp;
}

export function pythDataEncode(id: string, price: string, expo: number, publishTime: number) {
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
        pythId: hardhat.ethers.utils.formatBytes32String("USDC"),
        expo: -6,
    },
    {
        name: "Wrapped Ether",
        symbol: "WETH",
        pythId: hardhat.ethers.utils.formatBytes32String("WETH"),
        expo: -10,
    },
    {
        name: "Wrapped Bitcoin",
        symbol: "WBTC",
        pythId: hardhat.ethers.utils.formatBytes32String("WBTC"),
        expo: -8,
    },
];

export function getPythInfo(symbol: string) {
    for (const token of tokens) {
        if (token.symbol === symbol) return token;
    }
    throw new Error("token not found");
}

export async function updateChainlinkPrice(
    hre: HardhatRuntimeEnvironment,
    symbol: string,
    price: number,
    sender: ethers.Signer
) {
    const name = `ChainlinkAggregator${symbol}`;
    const aggregator_ = await hre.ethers.getContract(name, sender);
    const decimals = await aggregator_.decimals();
    const updateTime = await helpers.time.latest();
    await increaseNextBlockTimestamp(1);
    await (await aggregator_.feed(new BigNumber(price).times(10 ** decimals).toString(10), updateTime)).wait();
}

export async function getPythUpdateData(hre: HardhatRuntimeEnvironment, pythPrices: { [key: string]: number }) {
    const updateData = [];
    for (const [token, value] of Object.entries(pythPrices)) {
        const info = getPythInfo(token);
        const price = new BigNumber(value).multipliedBy(10 ** -info.expo).toString(10);
        const publishTime = await helpers.time.latest();
        const data = pythDataEncode(info.pythId, price, info.expo, publishTime);
        updateData.push(data);
    }
    const pyth_ = await hre.ethers.getContract(CONTRACTS.Pyth.name);
    const fee = await pyth_.getUpdateFee(updateData);
    return {
        updateData: updateData,
        fee: fee,
    };
}

export async function setPythAutoRefresh(hre: HardhatRuntimeEnvironment) {
    const pyth_ = await hre.ethers.getContract(CONTRACTS.Pyth.name);
    await (await pyth_.setAutoRefresh(true)).wait();
}

export async function setupPrices(
    hre: HardhatRuntimeEnvironment,
    chainlinkPrices: { [key: string]: number },
    pythPrices: { [key: string]: number },
    sender: ethers.Signer
) {
    for (const [key, value] of Object.entries(chainlinkPrices)) {
        await updateChainlinkPrice(hre, key, value, sender);
    }
    const pyth_ = await hre.ethers.getContract(CONTRACTS.Pyth.name, sender);
    const priceOracle_ = await getProxyContract(hre, CONTRACTS.PriceOracle, sender);
    for (const [token, value] of Object.entries(pythPrices)) {
        const info = getPythInfo(token);
        const price = new BigNumber(value).multipliedBy(10 ** -info.expo).toString(10);
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
