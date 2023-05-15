// SPDX-License-Identifier: MIT

pragma solidity ^0.8.2;

contract MarketSettingsContext {
    bytes32 internal constant PERP_DOMAIN = "perpDomain";

    /*=== general setting keys ===*/
    // trading
    bytes32 internal constant MAX_SLIPPAGE = "maxSlippage";
    // oracle
    bytes32 internal constant PYTH_MAX_AGE = "pythMaxAge";
    bytes32 internal constant MAX_PRICE_DIVERGENCE = "maxPriceDivergence";
    // margin
    bytes32 internal constant MAINTENANCE_MARGIN_RATIO = "maintenanceMarginRatio";
    bytes32 internal constant LIQUIDATION_FEE_RATIO = "liquidationFeeRatio";
    bytes32 internal constant MIN_LIQUIDATION_FEE = "minLiquidationFee";
    bytes32 internal constant MAX_LIQUIDATION_FEE = "maxLiquidationFee";
    bytes32 internal constant LIQUIDATION_PENALTY_RATIO = "liquidationPenaltyRatio";
    bytes32 internal constant LIQUIDATION_COUPON_RATIO = "liquidationCouponRatio";
    // incentives
    bytes32 internal constant VESYM_FEE_INCENTIVE_RATIO = "veSYMFeeIncentiveRatio";
    // fee
    bytes32 internal constant PERP_TRADING_FEE = "perpTradingFee";
    bytes32 internal constant LIQUIDITY_REDEEM_FEE = "liquidityRedeemFee";
    bytes32 internal constant MAX_COUPON_DEDUCTION_RATIO = "maxCouponDeductionRatio";
    // funding
    bytes32 internal constant MAX_FUNDING_VELOCITY = "maxFundingVelocity";
    // open interest
    bytes32 internal constant SOFT_LIMIT_THRESHOLD = "softLimitThreshold";
    bytes32 internal constant HARD_LIMIT_THRESHOLD = "hardLimitThreshold";
    bytes32 internal constant MAX_FINANCING_FEE_RATE = "maxFinancingFeeRate";
    bytes32 internal constant TOKEN_OI_LIMIT_RATIO = "tokenOILimitRatio";
    // position
    bytes32 internal constant MAX_LEVERAGE_RATIO = "maxLeverageRatio";
    bytes32 internal constant MIN_MARGIN = "minMargin";
    // order
    bytes32 internal constant MIN_ORDER_DELAY = "minOrderDelay";
    bytes32 internal constant MIN_KEEPER_FEE = "minKeeperFee";
    // I'm feeling lucky
    bytes32 internal constant ONE_DRAW_REQUIREMENT = "oneDrawRequirement";
    bytes32 internal constant ONE_DRAW_REWARD = "oneDrawReward";

    /*=== setting keys per market ===*/
    bytes32 internal constant PROPORTION_RATIO = "proportionRatio";
}
