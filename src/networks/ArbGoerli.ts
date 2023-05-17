import { NetworkConfigs } from "../config";
import { normalized } from "../utils/utils";

export const ArbGoerliTestnetConfig: NetworkConfigs = {
    addresses: {
        USDC: "0xCB31589c64d1fd499FDC67e068bbfc02e3d2D594",
        WETH: "0x9984C06f5133B44891f9429D5bC2dE1Aa326f1DB",
        WBTC: "0xa94376fa84691d27f263add4c5713Af9e147D070",
    },
    chainlink: {
        sequencerUptimeFeed: "0x4da69F028a5790fCCAfe81a75C0D24f46ceCDd69",
        aggregators: {
            USDC: "0x1692Bdd32F31b831caAc1b0c9fAF68613682813b",
            WETH: "0x62CAe0FA2da220f43a51F86Db2EDb36DcA9A5A08",
            WBTC: "0x6550bc2301936011c1334555e62A87705A81C12C",
        },
    },
    pyth: {
        priceFeed: "0x939C0e902FF5B3F7BA666Cc8F6aC75EE76d3f900",
        assetIds: {
            USDC: "0x41f3625971ca2ed2263e78573fe5ce23e13d2558ed3f2e47ab0f84fb9e7ae722",
            WETH: "0xca80ba6dc32e08d06f1aa886011eed1d77c77be9eb761cc10d72b7d0a2fd57a6",
            WBTC: "0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b",
        },
    },
    gracePeriodTime: 0,
    marketGeneralConfig: {
        pythMaxAge: 180, // 3 minutes
        maxPriceDivergence: normalized(1.02), // 2%
        maintenanceMarginRatio: normalized(0.02), // 2%
        maxLeverageRatio: 25, // 25x
        liquidationFeeRatio: normalized(0.0035), // 0.35%
        minLiquidationFee: normalized(1), // 1u
        maxLiquidationFee: normalized(1000), // 1000u
        liquidationPenaltyRatio: normalized(0.009), // 0.9%
        liquidationCouponRatio: normalized(0.001), // 0.1%
        liquidityRedeemFee: normalized(0.001), // 0.1%
        softLimitThreshold: normalized(0.7), // 70% of lp net value
        hardLimitThreshold: normalized(0.9), // 90% of lp net value
        minOrderDelay: 60, // 1 minute
        minKeeperFee: normalized(1), // 1 usd
        minMargin: normalized(20), // 20 usd
        maxSlippage: normalized(0.05), // 5%
        maxFundingVelocity: normalized(0.0533), // 5.33% / day^2
        maxFinancingFeeRate: normalized(0.09), // 9% per day
        perpTradingFee: normalized(0.001), // 0.1%
        maxCouponDeductionRatio: normalized(0.2), // 20%
        tokenOILimitRatio: normalized(1.1), // 110%
        veSYMFeeIncentiveRatio: normalized(0.1), // 10%
        oneDrawRequirement: normalized(1000),
        oneDrawReward: normalized(5),
        minCouponValue: normalized(1),
    },
    marketConfig: {
        WBTC: {
            proportionRatio: normalized(0.8), // 80%
        },
        WETH: {
            proportionRatio: normalized(0.75), // 75%
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
        tradingFeeRebateTiers: [
            { requirement: normalized(25000000), rebateRatio: normalized(0.1) },
            { requirement: normalized(5000000), rebateRatio: normalized(0.05) },
            { requirement: normalized(100000), rebateRatio: normalized(0.01) },
        ],
        symRate: [
            { startTime: 0, rate: normalized(1) },
            { startTime: 3000000000, rate: normalized(0) },
        ],
    },
};
