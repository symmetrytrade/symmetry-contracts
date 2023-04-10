// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../access/Ownable.sol";
import "../utils/Initializable.sol";
import "../utils/SafeDecimalMath.sol";
import "../utils/SafeCast.sol";
import "../oracle/PriceOracle.sol";
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
    // setting keys per market
    bytes32 public constant LAMBDA_PREMIUM = "lambdaPremium";
    bytes32 public constant PROPORTION_RATIO = "proportionRatio";
    bytes32 public constant PERP_TRADING_FEE = "perpTradingFee";

    // states
    address public market; // market
    address public perpTracker; // perpetual position tracker
    address public settings; // settings for markets

    modifier onlyMarket() {
        require(msg.sender == market, "FeeTracker: sender is not market");
        _;
    }

    /*=== initialize ===*/
    function initialize(
        address _market,
        address _perpTracker
    ) external onlyInitializeOnce {
        market = _market;
        perpTracker = _perpTracker;
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

    /*=== perp trading fee ===*/

    function _redeemTradeFillPrice(
        address _token,
        int _lp,
        int _redeemValue
    ) internal view returns (int fillPrice, int tradeAmount) {
        PerpTracker perpTracker_ = PerpTracker(perpTracker);
        MarketSettings settings_ = MarketSettings(settings);

        int skew = perpTracker_.currentSkew(_token);
        if (skew == 0) return (0, 0);
        tradeAmount = skew.multiplyDecimal(_redeemValue).divideDecimal(_lp);
        int lambda = settings_
            .getUintValsByMarket(perpTracker_.marketKey(_token), LAMBDA_PREMIUM)
            .toInt256();
        int kLP = settings_
            .getUintValsByMarket(
                perpTracker_.marketKey(_token),
                PROPORTION_RATIO
            )
            .toInt256();
        kLP = kLP.multiplyDecimal(_lp - _redeemValue);
        int price = PriceOracle(Market(market).priceOracle()).getPrice(
            _token,
            false
        );
        fillPrice = perpTracker_.computePerpFillPriceRaw(
            skew - tradeAmount,
            tradeAmount,
            price,
            kLP,
            lambda
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
    ) external view returns (uint fee) {
        PerpTracker perpTracker_ = PerpTracker(perpTracker);

        uint256 len = perpTracker_.marketTokensLength();
        for (uint i = 0; i < len; ++i) {
            address token = perpTracker_.marketTokensList(i);
            if (!perpTracker_.marketTokensListed(token)) continue;

            (int fillPrice, int tradeAmount) = _redeemTradeFillPrice(
                token,
                lp,
                redeemValue
            );
            if (tradeAmount == 0) continue;

            // calculate fill price
            // calculate execution price and fee
            (, uint256 tradingFee) = _discountedTradingFee(
                _account,
                token,
                tradeAmount,
                fillPrice
            );
            fee += tradingFee;
        }
    }

    function _discountedTradingFee(
        address,
        address _token,
        int256 _sizeDelta,
        int256 _price
    ) internal view returns (int256 execPrice, uint256 fee) {
        PerpTracker perpTracker_ = PerpTracker(perpTracker);
        // deduct trading fee in the price
        // (p_{oracle}-p_{avg})*size=(p_{oracle}-p_{fill})*size-p_{avg}*|size|*k%
        // p_{avg}=p_{fill} / (1 - k%) for size > 0
        // p_{avg}=p_{fill} / (1 + k%) for size < 0
        // where k is trading fee ratio
        int256 k = MarketSettings(settings)
            .getUintValsByMarket(
                perpTracker_.marketKey(_token),
                PERP_TRADING_FEE
            )
            .toInt256();
        // TODO: fee discount
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
    }

    function discountedTradingFee(
        address _account,
        address _token,
        int256 _sizeDelta,
        int256 _price
    ) external view returns (int256, uint256) {
        return _discountedTradingFee(_account, _token, _sizeDelta, _price);
    }
}
