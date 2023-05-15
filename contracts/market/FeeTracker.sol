// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../utils/Initializable.sol";
import "../utils/SafeDecimalMath.sol";
import "../utils/CommonContext.sol";

import "../interfaces/IMarketSettings.sol";
import "../interfaces/IFeeTracker.sol";
import "../interfaces/IPerpTracker.sol";
import "../interfaces/IPriceOracle.sol";
import "../interfaces/IMarket.sol";
import "../interfaces/IVotingEscrow.sol";
import "../interfaces/ITradingFeeCoupon.sol";

import "./MarketSettingsContext.sol";

contract FeeTracker is IFeeTracker, CommonContext, MarketSettingsContext, Ownable, Initializable {
    using SafeERC20 for IERC20;
    using SafeDecimalMath for uint;
    using SignedSafeDecimalMath for int;
    using SafeCast for uint;
    using SafeCast for int;

    // states
    address public market; // market
    address public perpTracker; // perpetual position tracker
    address public settings; // settings for markets
    address public votingEscrow; // voting escrow
    address public coupon;

    Tier[] public tradingFeeTiers; // trading fee tiers, in decending order

    mapping(uint => uint) public tradingFeeIncentives;
    mapping(address => mapping(uint => bool)) public claimed;

    modifier onlyMarket() {
        require(msg.sender == market, "FeeTracker: sender is not market");
        _;
    }

    /*=== initialize ===*/
    function initialize(address _market, address _perpTracker, address _coupon) external onlyInitializeOnce {
        market = _market;
        perpTracker = _perpTracker;
        coupon = _coupon;
        settings = IMarket(_market).settings();

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

    function _vePortionOf(address _account) internal view returns (uint) {
        IVotingEscrow votingEscrow_ = IVotingEscrow(votingEscrow);

        uint totalSupply = votingEscrow_.totalSupply();
        if (totalSupply > 0) {
            return votingEscrow_.balanceOf(_account).divideDecimal(totalSupply);
        }
        return 0;
    }

    function _tradingFeeDiscount(address _account) internal view returns (uint discount) {
        uint portion = _vePortionOf(_account);
        uint len = tradingFeeTiers.length;
        for (uint i = 0; i < len; ++i) {
            if (portion >= tradingFeeTiers[i].portion) {
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
        IPerpTracker perpTracker_ = IPerpTracker(perpTracker);
        IMarketSettings settings_ = IMarketSettings(settings);

        int skew = perpTracker_.currentSkew(_token);
        if (skew == 0) return (0, 0);
        tradeAmount = skew.multiplyDecimal(_redeemValue).divideDecimal(_lp);
        int kLP = settings_.getIntValsByMarket(perpTracker_.marketKey(_token), PROPORTION_RATIO);
        kLP = kLP.multiplyDecimal(_lp - _redeemValue).divideDecimal(_oraclePrice);
        fillPrice = perpTracker_.computePerpFillPriceRaw(skew - tradeAmount, tradeAmount, _oraclePrice, kLP, _lambda);
    }

    /**
     * @notice Compute the trading fee of a liquidity redemption. During lp redemption, the exiting lp will trade the position
     * it holds to the lp left in pool.
     * @param _lp lp net value in usd
     * @param _redeemValue lp to redeem in usd
     */
    function redeemTradingFee(address _account, int _lp, int _redeemValue) external onlyMarket returns (uint fee) {
        IPerpTracker perpTracker_ = IPerpTracker(perpTracker);

        uint len = perpTracker_.marketTokensLength();

        int lambda = IMarketSettings(settings).getIntVals(MAX_SLIPPAGE);
        for (uint i = 0; i < len; ++i) {
            address token = perpTracker_.marketTokensList(i);
            if (!perpTracker_.marketTokensListed(token)) continue;

            int oraclePrice = IPriceOracle(IMarket(market).priceOracle()).getPrice(token, false);

            (int fillPrice, int tradeAmount) = _redeemTradeFillPrice(token, oraclePrice, _lp, _redeemValue, lambda);
            if (tradeAmount == 0) continue;

            // calculate fill price
            // calculate execution price and fee
            (int execPrice, , ) = _discountedTradingFee(_account, tradeAmount, fillPrice, false);
            // pnl = (oracle_price - exec_price) * volume
            // fee = |pnl| = -pnl
            fee += (execPrice - oraclePrice).multiplyDecimal(tradeAmount).toUint256();
        }
    }

    function _discountedTradingFee(
        address _account,
        int _sizeDelta,
        int _price,
        bool _useCoupon
    ) internal returns (int execPrice, uint fee, uint couponUsed) {
        ITradingFeeCoupon coupon_ = ITradingFeeCoupon(coupon);

        // deduct trading fee in the price
        // (p_{oracle}-p_{exec})*size=(p_{oracle}-p_{fill})*size-p_{fill}*|size|*k%
        // p_{avg}=p_{fill} * (1 + k%) for size > 0
        // p_{avg}=p_{fill} * (1 - k%) for size < 0
        // where k is trading fee ratio
        int k = IMarketSettings(settings).getIntVals(PERP_TRADING_FEE);
        // apply fee discount
        k = k.multiplyDecimal(_UNIT - _tradingFeeDiscount(_account).toInt256());
        require(k < _UNIT, "Market: trading fee ratio > 1");
        if (_sizeDelta > 0) {
            execPrice = _price.multiplyDecimal(_UNIT + k);
        } else {
            execPrice = _price.multiplyDecimal(_UNIT - k);
        }
        fee = _price.multiplyDecimal(_sizeDelta.abs()).multiplyDecimal(k).toUint256();
        if (_useCoupon) {
            // use coupons
            couponUsed = IMarketSettings(settings).getIntVals(MAX_COUPON_DEDUCTION_RATIO).toUint256().multiplyDecimal(
                fee
            );
            couponUsed = coupon_.unspents(_account).min(couponUsed);
            coupon_.spend(_account, couponUsed);
        }
        // apply couponUsed to execPrice
        // (p_oracle - p_exec_new) * size = (p_oracle - p_exec_old) * size + coupon_used
        // p_exec_new = p_exec_old - coupon_used / size
        execPrice -= couponUsed.toInt256().divideDecimal(_sizeDelta);
    }

    function discountedTradingFee(
        address _account,
        int _sizeDelta,
        int _price,
        bool _useCoupon
    ) external onlyMarket returns (int, uint, uint) {
        return _discountedTradingFee(_account, _sizeDelta, _price, _useCoupon);
    }

    function liquidationPenalty(int notional) external view returns (int) {
        int liquidationPenaltyRatio = IMarketSettings(settings).getIntVals(LIQUIDATION_PENALTY_RATIO);
        return notional.abs().multiplyDecimal(liquidationPenaltyRatio);
    }

    function liquidationFee(int notional) external view returns (int) {
        int liquidationFeeRatio = IMarketSettings(settings).getIntVals(LIQUIDATION_FEE_RATIO);
        int fee = notional.abs().multiplyDecimal(liquidationFeeRatio);
        int minFee = IMarketSettings(settings).getIntVals(MIN_LIQUIDATION_FEE);
        int maxFee = IMarketSettings(settings).getIntVals(MAX_LIQUIDATION_FEE);
        return fee.max(minFee).min(maxFee);
    }

    /*=== fee incentives ===*/
    function distributeIncentives(uint _fee) external onlyMarket {
        tradingFeeIncentives[_startOfWeek(block.timestamp)] += _fee;
    }

    function claimIncentives(uint[] memory _ts) external {
        IVotingEscrow votingEscrow_ = IVotingEscrow(votingEscrow);

        uint currentWeek = _startOfWeek(block.timestamp);
        uint len = _ts.length;
        uint sum = 0;
        for (uint i = 0; i < len; ++i) {
            uint t = _startOfWeek(_ts[i]);
            require(t < currentWeek, "FeeTracker: invalid date");
            uint incentives = tradingFeeIncentives[t];
            if (incentives > 0 && !claimed[msg.sender][t]) {
                claimed[msg.sender][t] = true;
                uint total = votingEscrow_.totalSupplyAt(t);
                if (total > 0) {
                    sum += (incentives * votingEscrow_.balanceOfAt(msg.sender, t)) / total;
                }
            }
        }
        if (sum > 0) {
            IERC20(IMarket(market).baseToken()).safeTransfer(msg.sender, sum);
        }
    }
}
