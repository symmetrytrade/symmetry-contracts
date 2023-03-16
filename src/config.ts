import { BigNumber } from "bignumber.js";

const UNIT = new BigNumber("1000000000000000000");

function normalized(x: number) {
    return UNIT.times(x).toString(10);
}

interface ChainlinkConfig {
    sequencerUptimeFeed?: string;
    aggregators?: { [key: string]: string };
}

interface PythConfig {
    priceFeed: string;
    assetIds: { [key: string]: string };
}

interface MarketConfig {
    pythMaxAge: number;
    maxPriceDivergence: string;
    maintenanceMarginRatio: string;
}

interface NetworkConfigs {
    addresses?: { [key: string]: string };
    chainlink?: ChainlinkConfig;
    pyth?: PythConfig;
    gracePeriodTime: number;
    marketConfig: MarketConfig;
}

const DefaultConfig: NetworkConfigs = {
    gracePeriodTime: 0,
    marketConfig: {
        pythMaxAge: 180, // 3 minutes
        maxPriceDivergence: normalized(0.005), // 0.5%
        maintenanceMarginRatio: normalized(0.01), // 1%
    },
};

const GlobalConfig: { [key: string]: NetworkConfigs } = {
    arbitrum: {
        ...DefaultConfig,
        addresses: {
            USDC: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
        },
        chainlink: {
            sequencerUptimeFeed: "0xFdB631F5EE196F0ed6FAa767959853A9F217697D",
            aggregators: {
                USDC: "0x50834F3163758fcC1Df9973b6e91f0F0F0434aD3",
            },
        },
        pyth: {
            priceFeed: "0xff1a0f4744e8582DF1aE09D5611b887B6a12925C",
            assetIds: {
                USDC: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
            },
        },
    },
    hardhat: DefaultConfig,
};

function getConfig(network: string) {
    if (network in GlobalConfig) return GlobalConfig[network];
    return DefaultConfig;
}

export { GlobalConfig, DefaultConfig, getConfig };
