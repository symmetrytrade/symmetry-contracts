import { normalized } from "./utils/utils";

interface ChainlinkConfig {
    sequencerUptimeFeed?: string;
    aggregators?: { [key: string]: string };
}

interface PythConfig {
    priceFeed: string;
    assetIds: { [key: string]: string };
}

// to be loaded in MarketSetting contract
interface MarketGeneralConfig {
    pythMaxAge: number;
    maxPriceDivergence: string;
    maintenanceMarginRatio: string;
    maxLeverageRatio: number;
    liquidationFeeRatio: string;
    minLiquidationFee: string;
    maxLiquidationFee: string;
    liquidationPenaltyRatio: string;
    liquidationCouponRatio: string;
    liquidityRedeemFee: string;
    softLimitThreshold: string;
    hardLimitThreshold: string;
    minOrderDelay: number;
    minKeeperFee: string;
    minMargin: string;
    maxSlippage: string;
    maxFundingVelocity: string;
    maxFinancingFeeRate: string;
    perpTradingFee: string;
    tokenOILimitRatio: string;
    veSYMFeeIncentiveRatio: string;
}

// to be loaded in MarketSetting contract by market key
interface MarketConfig {
    proportionRatio: string;
}

// to be loaded in separate contracts
interface OtherConfig {
    lockMaxTime: number;
    vestingWeeks: number;
    liquidityGaugeStartTime: number;
    tradingFeeTiers: TradingFeeTier[];
    symRate: Rate[];
}

export interface NetworkConfigs {
    addresses?: { [key: string]: string };
    chainlink?: ChainlinkConfig;
    pyth?: PythConfig;
    gracePeriodTime: number;
    marketGeneralConfig: MarketGeneralConfig;
    marketConfig: { [key: string]: MarketConfig };
    otherConfig: OtherConfig;
}

export interface TradingFeeTier {
    portion: string;
    discount: string;
}

export interface Rate {
    startTime: number;
    rate: string;
}

const DefaultConfig: NetworkConfigs = {
    gracePeriodTime: 0,
    marketGeneralConfig: {
        pythMaxAge: 180, // 3 minutes
        maxPriceDivergence: normalized(1.005), // 0.5%
        maintenanceMarginRatio: normalized(0.02), // 2%
        maxLeverageRatio: 25, // 25x
        liquidationFeeRatio: normalized(0.0035), // 0.35%
        minLiquidationFee: normalized(1), // 1u
        maxLiquidationFee: normalized(1000), // 1000u
        liquidationPenaltyRatio: normalized(0.01), // 1%
        liquidationCouponRatio: normalized(0), // 0%
        liquidityRedeemFee: normalized(0.001), // 0.1%
        softLimitThreshold: normalized(0.5), // 50% of lp net value
        hardLimitThreshold: normalized(0.9), // 90% of lp net value
        minOrderDelay: 60, // 1 minute
        minKeeperFee: normalized(1), // 1 usd
        minMargin: normalized(50), // 20 usd
        maxSlippage: normalized(0.5),
        maxFundingVelocity: normalized(300), // 30000% / day^2
        maxFinancingFeeRate: normalized(0.09), // 9% per day
        perpTradingFee: normalized(0.001), // 0.1%
        tokenOILimitRatio: normalized(0.7),
        veSYMFeeIncentiveRatio: normalized(0), // 0%
    },
    marketConfig: {
        WBTC: {
            proportionRatio: normalized(1),
        },
        WETH: {
            proportionRatio: normalized(1),
        },
    },
    otherConfig: {
        lockMaxTime: 3600 * 24 * 365 * 2, // 2 years
        vestingWeeks: 12, // 12 weeks
        liquidityGaugeStartTime: 0, // 0 for now
        tradingFeeTiers: [
            { portion: normalized(0.005), discount: normalized(0.1) },
            { portion: normalized(0.001), discount: normalized(0.05) },
            { portion: normalized(0.0001), discount: normalized(0.03) },
            { portion: normalized(0.00001), discount: normalized(0.01) },
        ],
        symRate: [
            { startTime: 0, rate: normalized(1) },
            { startTime: 3000000000, rate: normalized(0) },
        ],
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
