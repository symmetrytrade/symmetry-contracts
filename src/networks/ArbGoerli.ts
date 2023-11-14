import { NetworkConfigs } from "../config";
import { normalized, usdcOf } from "../utils/utils";

export const ArbGoerliTestnetConfig: NetworkConfigs = {
    addresses: {
        USDC: "0xCB31589c64d1fd499FDC67e068bbfc02e3d2D594",
        WETH: "0x9984C06f5133B44891f9429D5bC2dE1Aa326f1DB",
        WBTC: "0xa94376fa84691d27f263add4c5713Af9e147D070",
        ARB: "0xa53e1cB3347D496DE01361A66C28c687933f7c96",
        LINK: "0xdCd5514f826eb16E1E85C28891fe47f96Eba29d3",
    },
    chainlink: {
        sequencerUptimeFeed: "0x4da69F028a5790fCCAfe81a75C0D24f46ceCDd69",
        aggregators: {
            USDC: "0x1692Bdd32F31b831caAc1b0c9fAF68613682813b",
            WETH: "0x62CAe0FA2da220f43a51F86Db2EDb36DcA9A5A08",
            WBTC: "0x6550bc2301936011c1334555e62A87705A81C12C",
            ARB: "0x2eE9BFB2D319B31A573EA15774B755715988E99D",
            LINK: "0xd28Ba6CA3bB72bF371b80a2a0a33cBcf9073C954",
        },
    },
    pyth: {
        priceFeed: "0x939C0e902FF5B3F7BA666Cc8F6aC75EE76d3f900",
        assetIds: {
            USDC: "0x41f3625971ca2ed2263e78573fe5ce23e13d2558ed3f2e47ab0f84fb9e7ae722",
            WETH: "0xca80ba6dc32e08d06f1aa886011eed1d77c77be9eb761cc10d72b7d0a2fd57a6",
            WBTC: "0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b",
            ARB: "0x37f40d2898159e8f2e52b93cb78f47cc3829a31e525ab975c49cc5c5d9176378",
            LINK: "0x83be4ed61dd8a3518d198098ce37240c494710a7b9d85e35d9fceac21df08994",
        },
    },
    gracePeriodTime: 0,
    marketGeneralConfig: {
        pythMaxAge: 60,
        maxPriceDivergence: normalized(1.02),
        minMaintenanceMargin: normalized(20),
        maintenanceMarginRatio: normalized(0.02),
        maxLeverageRatio: 25,
        liquidationFeeRatio: normalized(0.0035),
        minLiquidationFee: normalized(1),
        maxLiquidationFee: normalized(1000),
        liquidationPenaltyRatio: normalized(0.009),
        liquidationCouponRatio: normalized(0.001),
        liquidityRedeemFee: normalized(0.001),
        softLimitThreshold: normalized(0.7),
        hardLimitThreshold: normalized(0.9),
        minOrderDelay: 1,
        minKeeperFee: "1000000",
        minMargin: normalized(50),
        liquidityRange: normalized(0.05),
        priceDelay: 60,
        maxFundingVelocity: normalized(0.0533),
        maxFinancingFeeRate: normalized(0.09),
        perpTradingFee: normalized(0.001),
        maxCouponDeductionRatio: normalized(0.2),
        tokenOILimitRatio: normalized(1.1),
        veSYMFeeIncentiveRatio: normalized(0.2),
        treasuryFeeRatio: normalized(0.1),
        oneDrawRequirement: normalized(1000),
        oneDrawReward: normalized(5),
        minCouponValue: normalized(1),
        baseConversionRatio: normalized(1.2),
        maxDebtRatio: normalized(2), // 200%
        vertexDebtRatio: normalized(0.4), // 40%
        vertexInterestRate: normalized(0.25), // 25%
        maxInterestRate: normalized(1.2), // 120%
        minInterestRate: normalized(0.05), // 5%
        settleThreshold: usdcOf(10000), // 10000 USDC
    },
    marginConfig: {
        USDC: {
            conversionRatio: normalized(1),
            floorPriceRatio: normalized(1),
            collateralCap: "0",
        },
        WBTC: {
            conversionRatio: normalized(0.9),
            floorPriceRatio: normalized(0.99),
            collateralCap: normalized(100),
        },
    },
    marketConfig: {
        WBTC: {
            proportionRatio: normalized(0.8), // 80%
        },
        WETH: {
            proportionRatio: normalized(0.75), // 75%
        },
        LINK: {
            proportionRatio: normalized(0.75), // 75%
        },
        ARB: {
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
        luckyNumberAnnouncer: "0x47ED834153Ab43289Dae7C822EA25e2CE1A8F263",
        treasuryAddr: "0x9Eb8595d0ed3d46EBD991Fbae3ECb0E85e0354dB",
    },
};
