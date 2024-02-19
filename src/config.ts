import { ArbGoerliTestnetConfig } from "./networks/ArbGoerli";
import { ScrollConfig } from "./networks/Scroll";
import { ScrollSepoliaConfig } from "./networks/ScrollSepolia";
import { normalized, usdcOf } from "./utils/utils";

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
    maxPriceDivergence: bigint;
    minMaintenanceMargin: bigint;
    maintenanceMarginRatio: bigint;
    maxLeverageRatio: number;
    liquidationFeeRatio: bigint;
    minLiquidationFee: bigint;
    maxLiquidationFee: bigint;
    liquidationPenaltyRatio: bigint;
    liquidationCouponRatio: bigint;
    liquidityRedeemFee: bigint;
    softLimitThreshold: bigint;
    hardLimitThreshold: bigint;
    minOrderDelay: number;
    minKeeperFee: bigint;
    minMargin: bigint;
    liquidityRange: bigint;
    priceDelay: number;
    maxFundingVelocity: bigint;
    maxFinancingFeeRate: bigint;
    perpMakerFee: bigint;
    perpTakerFee: bigint;
    maxCouponDeductionRatio: bigint;
    tokenOILimitRatio: bigint;
    veSYMFeeIncentiveRatio: bigint;
    treasuryFeeRatio: bigint;
    oneDrawRequirement: bigint;
    oneDrawReward: bigint;
    minCouponValue: bigint;
    baseConversionRatio: bigint;
    maxDebtRatio: bigint;
    vertexDebtRatio: bigint;
    vertexInterestRate: bigint;
    maxInterestRate: bigint;
    minInterestRate: bigint;
    settleThreshold: bigint;
    collateralLiquidationPenalty: bigint;
    collateralPenaltyToLp: bigint;
}

// to be loaded in MarketSetting contract by market key
interface MarketConfig {
    proportionRatio: bigint;
}

interface MarginConfig {
    conversionRatio: bigint;
    floorPriceRatio: bigint;
    collateralCap: bigint;
}

// to be loaded in separate contracts
interface OtherConfig {
    lockMaxTime: number;
    vestingWeeks: number;
    liquidityGaugeStartTime: number;
    tradingFeeTiers: TradingFeeTier[];
    tradingFeeRebateTiers: TradingFeeRebateTier[];
    symRate: Rate[];
    luckyNumberAnnouncer?: string;
    treasuryAddr: string;
}

export interface NetworkConfigs {
    addresses?: { [key: string]: string };
    chainlink?: ChainlinkConfig;
    pyth?: PythConfig;
    gracePeriodTime: number;
    marketGeneralConfig: MarketGeneralConfig;
    marketConfig: { [key: string]: MarketConfig };
    marginConfig: { [key: string]: MarginConfig };
    otherConfig: OtherConfig;
}

export interface TradingFeeTier {
    portion: bigint;
    discount: bigint;
}

export interface TradingFeeRebateTier {
    requirement: bigint;
    rebateRatio: bigint;
}

export interface Rate {
    startTime: number;
    rate: bigint;
}

export const DefaultConfig: NetworkConfigs = {
    gracePeriodTime: 0,
    marketGeneralConfig: {
        pythMaxAge: 180, // 3 minutes
        maxPriceDivergence: normalized("1.005"), // 0.5%
        minMaintenanceMargin: normalized(20), // 20u
        maintenanceMarginRatio: normalized("0.02"), // 2%
        maxLeverageRatio: 25, // 25x
        liquidationFeeRatio: normalized("0.0035"), // 0.35%
        minLiquidationFee: normalized(1), // 1u
        maxLiquidationFee: normalized(1000), // 1000u
        liquidationPenaltyRatio: normalized("0.01"), // 1%
        liquidationCouponRatio: normalized(0), // 0%
        liquidityRedeemFee: normalized("0.001"), // 0.1%
        softLimitThreshold: normalized("0.5"), // 50% of lp net value
        hardLimitThreshold: normalized("0.9"), // 90% of lp net value
        minOrderDelay: 60, // 1 minute
        minKeeperFee: usdcOf(1), // 1 usd
        minMargin: normalized(50), // 50 usd
        liquidityRange: normalized("0.5"),
        priceDelay: 10, // 10 seconds,
        maxFundingVelocity: normalized(300), // 30000% / day^2
        maxFinancingFeeRate: normalized("0.09"), // 9% per day
        perpMakerFee: normalized("0.001"), // 0.1%
        perpTakerFee: normalized("0.002"), // 0.2%
        maxCouponDeductionRatio: normalized(1), // 100%
        tokenOILimitRatio: normalized("0.7"),
        veSYMFeeIncentiveRatio: normalized(0), // 0%
        treasuryFeeRatio: normalized(0), // 0%
        oneDrawRequirement: normalized(1000),
        oneDrawReward: normalized(5),
        minCouponValue: normalized(1), // 1 usd
        baseConversionRatio: normalized("1.2"), // 1.2
        maxDebtRatio: normalized(2), // 200%
        vertexDebtRatio: normalized("0.4"), // 40%
        vertexInterestRate: normalized("0.25"), // 25%
        maxInterestRate: normalized("1.2"), // 120%
        minInterestRate: normalized("0.05"), // 5%
        settleThreshold: usdcOf(10000), // 10000 USDC
        collateralLiquidationPenalty: normalized("0.01"), // 1%
        collateralPenaltyToLp: normalized("0.5"), // 50%
    },
    marketConfig: {
        WBTC: {
            proportionRatio: normalized(1),
        },
        WETH: {
            proportionRatio: normalized(1),
        },
    },
    marginConfig: {
        USDC: {
            conversionRatio: normalized(1),
            floorPriceRatio: normalized(1),
            collateralCap: 0n,
        },
        WBTC: {
            conversionRatio: normalized("0.9"),
            floorPriceRatio: normalized("0.99"),
            collateralCap: normalized(100),
        },
        WETH: {
            conversionRatio: normalized("0.9"),
            floorPriceRatio: normalized("0.985"),
            collateralCap: normalized(1000),
        },
    },
    otherConfig: {
        lockMaxTime: 3600 * 24 * 365 * 2, // 2 years
        vestingWeeks: 12, // 12 weeks
        liquidityGaugeStartTime: 0, // 0 for now
        tradingFeeTiers: [
            { portion: normalized("0.005"), discount: normalized("0.1") },
            { portion: normalized("0.001"), discount: normalized("0.05") },
            { portion: normalized("0.0001"), discount: normalized("0.03") },
            { portion: normalized("0.00001"), discount: normalized("0.01") },
        ],
        tradingFeeRebateTiers: [
            { requirement: normalized(25000000), rebateRatio: normalized("0.1") },
            { requirement: normalized(5000000), rebateRatio: normalized("0.05") },
            { requirement: normalized(100000), rebateRatio: normalized("0.01") },
        ],
        symRate: [
            { startTime: 0, rate: normalized(1) },
            { startTime: 3000000000, rate: normalized(0) },
        ],
        treasuryAddr: "0x9Eb8595d0ed3d46EBD991Fbae3ECb0E85e0354dB",
    },
};

export const GlobalConfig: { [key: string]: NetworkConfigs } = {
    ArbGoerliTestnet: ArbGoerliTestnetConfig,
    ScrollSepolia: ScrollSepoliaConfig,
    Scroll: ScrollConfig,
    hardhat: DefaultConfig,
};

export function getConfig(network: string) {
    if (network in GlobalConfig) return GlobalConfig[network];
    if (network === "hardhat") {
        return DefaultConfig;
    }
    throw new Error(`network ${network} non-exist`);
}
