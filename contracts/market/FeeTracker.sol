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

    // reserved storage slots for base contract upgrade in future
    uint256[50] private __gap;

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
    function initialize(
        address _market,
        address _perpTracker,
        address _coupon,
        address _votingEscrow
    ) external onlyInitializeOnce {
        market = _market;
        perpTracker = _perpTracker;
        coupon = _coupon;
        settings = IMarket(_market).settings();
        votingEscrow = _votingEscrow;

        _transferOwnership(msg.sender);
    }

    /*=== owner functions ===*/

    function setTradingFeeTiers(Tier[] memory _tiers) external onlyOwner {
        delete tradingFeeTiers;

        uint len = _tiers.length;
        for (uint i = 0; i < len; ++i) {
            if (i > 0) {
                require(_tiers[i - 1].portion > _tiers[i].portion, "FeeTracker: tier not decreasing");
            }
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

    function tradingFeeDiscount(address _account) public view returns (uint discount) {
        uint portion = _vePortionOf(_account);
        uint len = tradingFeeTiers.length;
        for (uint i = 0; i < len; ++i) {
            if (portion >= tradingFeeTiers[i].portion) {
                discount = tradingFeeTiers[i].discount;
                break;
            }
        }
    }

    /*=== perp trading fee ===*/

    function getDiscountedPrice(
        address _account,
        int _sizeDelta,
        int _price
    ) external view returns (int execPrice, uint fee, uint couponUsed) {
        // deduct trading fee in the price
        // (p_{oracle}-p_{exec})*size=(p_{oracle}-p_{fill})*size-p_{fill}*|size|*k
        // p_{avg}=p_{fill} * (1 + k) for size > 0
        // p_{avg}=p_{fill} * (1 - k) for size < 0
        // where k is trading fee ratio
        int k = IMarketSettings(settings).getIntVals(PERP_TRADING_FEE);
        // apply fee discount
        k = k.multiplyDecimal(_UNIT - tradingFeeDiscount(_account).toInt256());
        require(k < _UNIT, "FeeTracker: trading fee ratio > 1");
        if (_sizeDelta > 0) {
            execPrice = _price.multiplyDecimal(_UNIT + k);
        } else {
            execPrice = _price.multiplyDecimal(_UNIT - k);
        }
        fee = _price.multiplyDecimal(_sizeDelta.abs()).multiplyDecimal(k).toUint256();
        // use coupons
        ITradingFeeCoupon coupon_ = ITradingFeeCoupon(coupon);

        couponUsed = IMarketSettings(settings).getIntVals(MAX_COUPON_DEDUCTION_RATIO).toUint256().multiplyDecimal(fee);
        couponUsed = coupon_.unspents(_account).min(couponUsed);
        // apply couponUsed to execPrice
        // (p_oracle - p_exec_new) * size = (p_oracle - p_exec_old) * size + coupon_used
        // p_exec_new = p_exec_old - coupon_used / size
        execPrice -= couponUsed.toInt256().divideDecimal(_sizeDelta);
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
