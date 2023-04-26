// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../utils/Initializable.sol";
import "../utils/SafeDecimalMath.sol";
import "../oracle/PriceOracle.sol";
import "../tokenomics/VotingEscrow.sol";
import "../tokens/TradingFeeCoupon.sol";
import "./MarketSettings.sol";
import "./PerpTracker.sol";

contract FeeTracker is Ownable, Initializable {
    using SafeDecimalMath for uint256;
    using SignedSafeDecimalMath for int256;
    using SafeCast for uint256;
    using SafeCast for int256;

    // same unit in SafeDeicmalMath and SignedSafeDeicmalMath
    int256 private constant _UNIT = int(10 ** 18);

    // general setting keys
    bytes32 public constant MAX_SLIPPAGE = "maxSlippage";
    bytes32 public constant LIQUIDATION_FEE_RATIO = "liquidationFeeRatio";
    bytes32 public constant MIN_LIQUIDATION_FEE = "minLiquidationFee";
    bytes32 public constant MAX_LIQUIDATION_FEE = "maxLiquidationFee";
    bytes32 public constant LIQUIDATION_PENALTY_RATIO =
        "liquidationPenaltyRatio";
    bytes32 public constant PERP_TRADING_FEE = "perpTradingFee";
    // setting keys per market
    bytes32 public constant PROPORTION_RATIO = "proportionRatio";

    struct Tier {
        uint256 portion; // veSYM holding portion
        uint256 discount; // discount percent
    }

    // states
    address public market; // market
    address public perpTracker; // perpetual position tracker
    address public settings; // settings for markets
    address public votingEscrow; // voting escrow
    address public coupon;

    Tier[] public tradingFeeTiers; // trading fee tiers, in decending order

    modifier onlyMarket() {
        require(msg.sender == market, "FeeTracker: sender is not market");
        _;
    }

    /*=== initialize ===*/
    function initialize(
        address _market,
        address _perpTracker,
        address _coupon
    ) external onlyInitializeOnce {
        market = _market;
        perpTracker = _perpTracker;
        coupon = _coupon;
        settings = Market(_market).settings();

        _transferOwnership(msg.sender);
    }

    /*=== owner functions ===*/

    function setMarket(address _market) external onlyOwner {
        market = _market;
    }

    function setPerpTracker(address _perpTracker) external onlyOwner {
        perpTracker = _perpTracker;
    }

    function setSetting(address _settings) external onlyOwner {
        settings = _settings;
    }

    function setVotingEscrow(address _votingEscrow) external onlyOwner {
        votingEscrow = _votingEscrow;
    }

    function setCoupon(address _coupon) external onlyOwner {
        coupon = _coupon;
    }

    function setTradingFeeTiers(Tier[] memory _tiers) external onlyOwner {
        delete tradingFeeTiers;

        uint len = _tiers.length;
        for (uint i = 0; i < len; ++i) {
            tradingFeeTiers.push(_tiers[i]);
        }
    }

    /*=== discount === */

    function _vePortionOf(address _account) internal view returns (uint256) {
        VotingEscrow votingEscrow_ = VotingEscrow(votingEscrow);

        uint256 totalSupply = votingEscrow_.totalSupply();
        if (totalSupply > 0) {
            return votingEscrow_.balanceOf(_account).divideDecimal(totalSupply);
        }
        return 0;
    }

    function _tradingFeeDiscount(
        address _account
    ) internal view returns (uint256 discount) {
        uint portion = _vePortionOf(_account);
        uint len = tradingFeeTiers.length;
        for (uint i = 0; i < len; ++i) {
            if (portion > tradingFeeTiers[i].portion) {
                discount = tradingFeeTiers[i].discount;
                return discount;
            }
        }
    }

    /*=== perp trading fee ===*/

    function _redeemTradeFillPrice(
        address _token,
        int _oraclePrice,
        int _lp,
        int _redeemValue,
        int _lambda
    ) internal view returns (int fillPrice, int tradeAmount) {
        PerpTracker perpTracker_ = PerpTracker(perpTracker);
        MarketSettings settings_ = MarketSettings(settings);

        int skew = perpTracker_.currentSkew(_token);
        if (skew == 0) return (0, 0);
        tradeAmount = skew.multiplyDecimal(_redeemValue).divideDecimal(_lp);
        int kLP = settings_.getIntValsByMarket(
            perpTracker_.marketKey(_token),
            PROPORTION_RATIO
        );
        kLP = kLP.multiplyDecimal(_lp - _redeemValue).divideDecimal(
            _oraclePrice
        );
        fillPrice = perpTracker_.computePerpFillPriceRaw(
            skew - tradeAmount,
            tradeAmount,
            _oraclePrice,
            kLP,
            _lambda
        );
    }

    /**
     * @notice Compute the trading fee of a liquidity redemption. During lp redemption, the exiting lp will trade the position
     * it holds to the lp left in pool.
     * @param lp lp net value in usd
     * @param redeemValue lp to redeem in usd
     */
    function redeemTradingFee(
        address _account,
        int lp,
        int redeemValue
    ) external returns (uint fee) {
        PerpTracker perpTracker_ = PerpTracker(perpTracker);

        uint256 len = perpTracker_.marketTokensLength();

        int lambda = MarketSettings(settings).getIntVals(MAX_SLIPPAGE);
        for (uint i = 0; i < len; ++i) {
            address token = perpTracker_.marketTokensList(i);
            if (!perpTracker_.marketTokensListed(token)) continue;

            int oraclePrice = PriceOracle(Market(market).priceOracle())
                .getPrice(token, false);

            (int fillPrice, int tradeAmount) = _redeemTradeFillPrice(
                token,
                oraclePrice,
                lp,
                redeemValue,
                lambda
            );
            if (tradeAmount == 0) continue;

            // calculate fill price
            // calculate execution price and fee
            (int256 execPrice, , ) = _discountedTradingFee(
                _account,
                tradeAmount,
                fillPrice
            );
            // pnl = (oracle_price - exec_price) * volume
            // fee = |pnl| = -pnl
            fee += (execPrice - oraclePrice)
                .multiplyDecimal(tradeAmount)
                .toUint256();
        }
    }

    function _discountedTradingFee(
        address _account,
        int256 _sizeDelta,
        int256 _price
    ) internal returns (int256 execPrice, uint256 fee, uint256 couponUsed) {
        TradingFeeCoupon coupon_ = TradingFeeCoupon(coupon);

        // deduct trading fee in the price
        // (p_{oracle}-p_{avg})*size=(p_{oracle}-p_{fill})*size-p_{avg}*|size|*k%
        // p_{avg}=p_{fill} / (1 - k%) for size > 0
        // p_{avg}=p_{fill} / (1 + k%) for size < 0
        // where k is trading fee ratio
        int256 k = MarketSettings(settings).getIntVals(PERP_TRADING_FEE);
        // apply fee discount
        k = k.multiplyDecimal(_UNIT - _tradingFeeDiscount(_account).toInt256());
        require(k < _UNIT, "Market: trading fee ratio > 1");
        if (_sizeDelta > 0) {
            execPrice = _price.divideDecimal(_UNIT - k);
        } else {
            execPrice = _price.divideDecimal(_UNIT + k);
        }
        fee = execPrice
            .multiplyDecimal(_sizeDelta.abs())
            .multiplyDecimal(k)
            .toUint256();
        // use coupons
        couponUsed = coupon_.unspents(_account).min(fee);
        coupon_.spend(_account, couponUsed);
        // apply couponUsed to execPrice
        // (p_oracle - p_exec_new) * size = (p_oracle - p_exec_old) * size + coupon_used
        // p_exec_new = p_exec_old - coupon_used / size
        execPrice -= couponUsed.toInt256().divideDecimal(_sizeDelta);
    }

    function discountedTradingFee(
        address _account,
        int256 _sizeDelta,
        int256 _price
    ) external returns (int256, uint256, uint256) {
        return _discountedTradingFee(_account, _sizeDelta, _price);
    }

    function liquidationPenalty(int notional) external view returns (int) {
        int256 liquidationPenaltyRatio = MarketSettings(settings).getIntVals(
            LIQUIDATION_PENALTY_RATIO
        );
        return notional.abs().multiplyDecimal(liquidationPenaltyRatio);
    }

    function liquidationFee(int notional) external view returns (int) {
        int liquidationFeeRatio = MarketSettings(settings).getIntVals(
            LIQUIDATION_FEE_RATIO
        );
        int fee = notional.abs().multiplyDecimal(liquidationFeeRatio);
        int minFee = MarketSettings(settings).getIntVals(MIN_LIQUIDATION_FEE);
        int maxFee = MarketSettings(settings).getIntVals(MAX_LIQUIDATION_FEE);
        return fee.max(minFee).min(maxFee);
    }
}
