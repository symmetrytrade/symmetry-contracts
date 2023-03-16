import hardhat from "hardhat";

const abiCoder = new hardhat.ethers.utils.AbiCoder();

export function pythDataEncode(
    id: string,
    price: string,
    expo: number,
    publishTime: number
) {
    return abiCoder.encode(
        ["bytes32", "int64", "int32", "uint256"],
        [id, price, expo, publishTime]
    );
}

export const chainlinkAggregators = [
    { name: "Sequencer", decimals: 0 },
    { name: "USDC", decimals: 6 },
    { name: "WETH", decimals: 18 },
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
