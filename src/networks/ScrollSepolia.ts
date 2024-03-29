import { NetworkConfigs } from "../config";
import { normalized, tokenOf, usdcOf } from "../utils/utils";

export const ScrollSepoliaConfig: NetworkConfigs = {
    addresses: {
        USDC: "0x454c861f9DAE3aD9ab9d431825b8C935549a8D40",
        WETH: "0x863d7Abb9c62d8Bc69eA9EbC3E3583057D533e6f",
        WBTC: "0xd2406163DaEf35d8Ee069F3B6b034451e60Db8A4",
        LINK: "0x6E2cA697c9b19Bf403bca4B8D2ADFf3abeb496a0",
    },
    chainlink: {
        sequencerUptimeFeed: "0x0000000000000000000000000000000000000000",
        aggregators: {
            USDC: "0xFadA8b0737D4A3AE7118918B7E69E689034c0127",
            WETH: "0x59F1ec1f10bD7eD9B938431086bC1D9e233ECf41",
            WBTC: "0x87dce67002e66C17BC0d723Fe20D736b80CAaFda",
            LINK: "0xaC3E04999aEfE44D508cB3f9B972b0Ecd07c1efb",
        },
    },
    pyth: {
        priceFeed: "0xA2aa501b19aff244D90cc15a4Cf739D2725B5729",
        assetIds: {
            USDC: "0x41f3625971ca2ed2263e78573fe5ce23e13d2558ed3f2e47ab0f84fb9e7ae722",
            WETH: "0xca80ba6dc32e08d06f1aa886011eed1d77c77be9eb761cc10d72b7d0a2fd57a6",
            WBTC: "0xf9c0172ba10dfa4d19088d94f5bf61d3b54d5bd7483a322a982e1373ee8ea31b",
            LINK: "0x83be4ed61dd8a3518d198098ce37240c494710a7b9d85e35d9fceac21df08994",
        },
    },
    gracePeriodTime: 0,
    marketGeneralConfig: {
        pythMaxAge: 60,
        maxPriceDivergence: normalized("1.02"),
        minMaintenanceMargin: normalized(20),
        maintenanceMarginRatio: normalized("0.02"),
        maxLeverageRatio: 25,
        liquidationFeeRatio: normalized("0.0035"),
        minLiquidationFee: normalized(1),
        maxLiquidationFee: normalized(1000),
        liquidationPenaltyRatio: normalized("0.009"),
        liquidationCouponRatio: normalized("0.001"),
        liquidityRedeemFee: normalized("0.001"),
        softLimitThreshold: normalized("0.7"),
        hardLimitThreshold: normalized("0.9"),
        minOrderDelay: 1,
        minKeeperFee: usdcOf(1),
        minMargin: normalized(50),
        liquidityRange: normalized("0.05"),
        priceDelay: 60,
        maxFundingVelocity: normalized("0.0533"),
        maxFinancingFeeRate: normalized("0.09"),
        perpMakerFee: normalized("0.0008"),
        perpTakerFee: normalized("0.001"),
        maxCouponDeductionRatio: normalized("0.2"),
        tokenOILimitRatio: normalized("1.1"),
        veSYMFeeIncentiveRatio: normalized(0),
        treasuryFeeRatio: normalized("0.3"),
        oneDrawRequirement: normalized(1000),
        oneDrawReward: normalized(5),
        minCouponValue: normalized(1),
        baseConversionRatio: normalized("1.2"),
        maxDebtRatio: normalized(2), // 200%
        vertexDebtRatio: normalized("0.4"), // 40%
        vertexInterestRate: normalized("0.25"), // 25%
        maxInterestRate: normalized("1.2"), // 120%
        minInterestRate: normalized("0.05"), // 5%
        settleThreshold: usdcOf(10000), // 10000 USDC
        collateralLiquidationPenalty: normalized("0.01"), // 1%
        collateralPenaltyToLp: normalized("0.5"), // 50%
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
            collateralCap: tokenOf(100, 8),
        },
        WETH: {
            conversionRatio: normalized("0.9"),
            floorPriceRatio: normalized("0.985"),
            collateralCap: normalized(10000),
        },
    },
    marketConfig: {
        WBTC: {
            proportionRatio: normalized("0.8"), // 80%
        },
        WETH: {
            proportionRatio: normalized("0.75"), // 75%
        },
        LINK: {
            proportionRatio: normalized("0.75"), // 75%
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
            { startTime: 0, rate: normalized(0) },
            { startTime: 3000000000, rate: normalized(0) },
        ],
        luckyNumberAnnouncer: "0x47ED834153Ab43289Dae7C822EA25e2CE1A8F263",
        treasuryAddr: "0x9Eb8595d0ed3d46EBD991Fbae3ECb0E85e0354dB",
    },
};
