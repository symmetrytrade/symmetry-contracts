import { normalized } from "./utils/utils";

interface ChainlinkConfig {
    sequencerUptimeFeed?: string;
    aggregators?: { [key: string]: string };
}

interface PythConfig {
    priceFeed: string;
    assetIds: { [key: string]: string };
}

interface MarketGeneralConfig {
    pythMaxAge: number;
    maxPriceDivergence: string;
    maintenanceMarginRatio: string;
    maxLeverageRatio: string;
    liquidationFeeRatio: string;
    liquidationPenaltyRatio: string;
    liquidityRemoveCooldown: number;
    maxSoftLimit: string;
    softLimitThreshold: string;
    hardLimitThreshold: string;
    maxFinancingFeeRate: string;
    minOrderDelay: number;
    kLpSensitivity: string;
}

interface MarketConfig {
    maxFundingVelocity: string;
    skewScale: string;
    lambdaPremium: string;
}

export interface NetworkConfigs {
    addresses?: { [key: string]: string };
    chainlink?: ChainlinkConfig;
    pyth?: PythConfig;
    gracePeriodTime: number;
    marketGeneralConfig: MarketGeneralConfig;
    marketConfig: { [key: string]: MarketConfig };
}

const DefaultConfig: NetworkConfigs = {
    gracePeriodTime: 0,
    marketGeneralConfig: {
        pythMaxAge: 180, // 3 minutes
        maxPriceDivergence: normalized(1.005), // 0.5%
        maintenanceMarginRatio: normalized(0.02), // 2%
        maxLeverageRatio: normalized(0.04), // 4%, 25x
        liquidationFeeRatio: normalized(0.001), // 0.1%
        liquidationPenaltyRatio: normalized(0.001), // 0.1%
        liquidityRemoveCooldown: 10, // seconds
        maxSoftLimit: normalized(1000000), // 1 mio usd
        softLimitThreshold: normalized(0.5), // 50% of lp net value
        hardLimitThreshold: normalized(0.9), // 90% of lp net value
        maxFinancingFeeRate: normalized(100), // 100% per day
        minOrderDelay: 60, // 1 minute
        kLpSensitivity: normalized(1),
    },
    marketConfig: {
        WBTC: {
            maxFundingVelocity: normalized(300),
            skewScale: normalized(1000000), // 100w
            lambdaPremium: normalized(0.5),
        },
        WETH: {
            maxFundingVelocity: normalized(300),
            skewScale: normalized(1000000), // 100w
            lambdaPremium: normalized(0.5),
        },
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
