import { NetworkConfigs } from "../config";
import { normalized, usdcOf } from "../utils/utils";

export const ScrollConfig: NetworkConfigs = {
    addresses: {
        USDC: "0x06efdbff2a14a7c8e15944d1f4a48f9f95f663a4",
        USDT: "0xf55bec9cafdbe8730f096aa55dad6d22d44099df",
        WETH: "0x5300000000000000000000000000000000000004",
        WBTC: "0x3c1bca5a656e69edcd0d4e36bebb3fcdaca60cf1",
        WSTETH: "0xf610A9dfB7C89644979b4A0f27063E9e7d7Cda32",
    },
    chainlink: {
        sequencerUptimeFeed: "0x0000000000000000000000000000000000000000",
        aggregators: {
            USDC: "0x43d12Fb3AfCAd5347fA764EeAB105478337b7200",
            USDT: "0xf376A91Ae078927eb3686D6010a6f1482424954E",
            WETH: "0x6bF14CB0A831078629D993FDeBcB182b21A8774C",
            WBTC: "0xCaca6BFdeDA537236Ee406437D2F8a400026C589",
            WSTETH: "0xE61Da4C909F7d86797a0D06Db63c34f76c9bCBDC",
        },
    },
    pyth: {
        priceFeed: "0xA2aa501b19aff244D90cc15a4Cf739D2725B5729",
        assetIds: {
            USDC: "0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a",
            USDT: "0x2b89b9dc8fdf9f34709a5b106b472f0f39bb6ca9ce04b0fd7f2e971688e2e53b",
            WETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
            WBTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
            WSTETH: "0x6df640f3b8963d8f8358f791f352b8364513f6ab1cca5ed3f1f7b5448980e784",
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
        minLiquidationFee: normalized(5),
        maxLiquidationFee: normalized(1000),
        liquidationPenaltyRatio: normalized(0.009),
        liquidationCouponRatio: normalized(0.001),
        liquidityRedeemFee: normalized(0.001),
        softLimitThreshold: normalized(0.7),
        hardLimitThreshold: normalized(0.9),
        minOrderDelay: 1,
        minKeeperFee: "5000000",
        minMargin: normalized(20),
        liquidityRange: normalized(0.05),
        priceDelay: 60,
        maxFundingVelocity: normalized(0.0533),
        maxFinancingFeeRate: normalized(0.09),
        perpTradingFee: normalized(0.001),
        maxCouponDeductionRatio: normalized(0.2),
        tokenOILimitRatio: normalized(1.1),
        veSYMFeeIncentiveRatio: normalized(0),
        treasuryFeeRatio: normalized(0.3),
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
        collateralLiquidationPenalty: normalized(0.01), // 1%
        collateralPenaltyToLp: normalized(0.5), // 50%
    },
    marginConfig: {
        USDC: {
            conversionRatio: normalized(1),
            floorPriceRatio: normalized(1),
            collateralCap: "0",
        },
        WETH: {
            conversionRatio: normalized(0.9),
            floorPriceRatio: normalized(0.985),
            collateralCap: "0",
        },
        WBTC: {
            conversionRatio: normalized(0.9),
            floorPriceRatio: normalized(0.99),
            collateralCap: "0",
        },
        USDT: {
            conversionRatio: normalized(0.95),
            floorPriceRatio: normalized(0.995),
            collateralCap: "0",
        },
        WSTETH: {
            conversionRatio: normalized(0.85),
            floorPriceRatio: normalized(0.98),
            collateralCap: "0",
        },
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
            { startTime: 0, rate: normalized(0) },
            { startTime: 3000000000, rate: normalized(0) },
        ],
        luckyNumberAnnouncer: "0x408c26a70ca09ccd3808dbbea043311c35fb7730",
        treasuryAddr: "0x0B62247F3eD3163275253140CB98e56CfA0091f1",
    },
};
