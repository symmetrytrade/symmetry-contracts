// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../access/Ownable.sol";
import "../utils/SafeDecimalMath.sol";
import "../utils/Initializable.sol";
import "../utils/SafeCast.sol";
import "./Market.sol";
import "./MarketSettings.sol";

contract PerpTracker is Ownable, Initializable {
    using SignedSafeDecimalMath for int256;
    using SafeCast for uint256;

    // setting keys
    bytes32 public constant PERP_DOMAIN = "perpDomain";
    bytes32 public constant SKEW_SCALE = "skewScale";
    bytes32 public constant LAMBDA_PREMIUM = "lambdaPremium";
    bytes32 public constant K_LP_SENSITIVITY = "kLpSensitivity";
    bytes32 public constant MAX_SOFT_LIMIT = "maxSoftLimit";
    bytes32 public constant SOFT_LIMIT_THRESHOLD = "softLimitThreshold";
    bytes32 public constant HARD_LIMIT_THRESHOLD = "hardLimitThreshold";
    bytes32 public constant MAX_FINANCING_FEE_RATE = "maxFinancingFeeRate";
    bytes32 public constant MAX_FUNDING_VELOCITY = "maxFundingVelocity";

    // same unit in SafeDeicmalMath and SignedSafeDeicmalMath
    int256 private constant _UNIT = int(10 ** 18);

    struct GlobalPosition {
        int256 longSize; // long position hold by lp in underlying, positive, 18 decimals
        int256 shortSize; // short position hold by lp in underlying, negative, 18 decimals
        int256 avgPrice; // average price for the lp net position (long + short)
        int256 accFunding; // accumulate funding fee for unit position size at the time of latest open/close position or lp in/out
        int256 accLongFinancingFee; // accumulate long financing fee for unit position size at the latest position modification
        int256 accShortFinancingFee; // accumulate short financing fee for unit position size at the latest position modification
    }

    struct Position {
        int256 size; // position size, positive for long, negative for short, 18 decimals
        int256 accFunding; // accumulate funding fee for unit position size at the latest position modification
        int256 accFinancingFee; // accumulate financing fee for unit position size at the latest position modification
        int256 avgPrice;
    }

    struct FeeInfo {
        int256 accFunding; // the latest accumulate funding fee for unit position size
        int256 fundingRate; // the latest funding rate
        int256 accLongFinancingFee; // the latest long financing fee
        int256 accShortFinancingFee; // the latest short financing fee
        int256 updateTime; // the latest fee update time
    }

    struct TokenInfo {
        int256 lpNetValue; // latest lp net value when any position of the token is updated
        int256 netOpenInterest; // latest net open interest when any position of the token is updated
        int256 skew; // latest token skew(in USD) when any position of the token is updated
    }

    address public market;
    address public settings;
    address[] public marketTokensList; // market tokens
    mapping(address => bool) public marketTokensListed;

    mapping(address => GlobalPosition) public globalPositions; // lp global positions
    mapping(address => mapping(address => Position)) private userPositions; // positions of single user, user => token => position mapping
    mapping(address => int256) public userMargin; // margin(include realized pnl) of user

    mapping(address => FeeInfo) private feeInfos;
    mapping(address => TokenInfo) private tokenInfos;

    modifier onlyMarket() {
        require(msg.sender == market, "PerpTracker: sender is not market");
        _;
    }

    /*=== initialize ===*/

    function initialize(address _market) external onlyInitializeOnce {
        market = _market;
        settings = Market(_market).settings();

        _transferOwnership(msg.sender);
    }

    /*=== owner ===*/

    function setMarket(address _market) external onlyOwner {
        market = _market;
    }

    function setSetting(address _settings) external onlyOwner {
        settings = _settings;
    }

    /* === Token Management === */

    function setMarketToken(address _token) external onlyOwner {
        if (!marketTokensListed[_token]) {
            marketTokensListed[_token] = true;
            marketTokensList.push(_token);
        }
        if (feeInfos[_token].updateTime == 0)
            feeInfos[_token].updateTime = int(block.timestamp);
    }

    function removeToken(uint256 _tokenIndex) external onlyOwner {
        uint256 len = marketTokensList.length;
        require(len > _tokenIndex, "PerpTracker: token index out of bound");
        address token = marketTokensList[_tokenIndex];
        delete marketTokensListed[token];
        marketTokensList[_tokenIndex] = marketTokensList[len - 1];
        marketTokensList.pop();
    }

    /*=== view functions === */

    function getGlobalPosition(
        address _token
    ) external view returns (GlobalPosition memory) {
        return globalPositions[_token];
    }

    /**
     * @notice get user net position of a token
     * @return long position size, short position size
     */
    function getGlobalPositionSize(
        address _token
    ) external view returns (int256, int256) {
        return (
            -globalPositions[_token].shortSize,
            -globalPositions[_token].longSize
        );
    }

    function marketTokensLength() external view returns (uint256) {
        return marketTokensList.length;
    }

    function getPosition(
        address _account,
        address _token
    ) external view returns (Position memory) {
        return userPositions[_account][_token];
    }

    function getPositionSize(
        address _account,
        address _token
    ) external view returns (int256) {
        return userPositions[_account][_token].size;
    }

    function latestAccFunding(address _token) external view returns (int256) {
        return feeInfos[_token].accFunding;
    }

    function latestAccFinancingFee(
        address _token
    ) external view returns (int256, int256) {
        return (
            feeInfos[_token].accLongFinancingFee,
            feeInfos[_token].accShortFinancingFee
        );
    }

    /*=== update functions ===*/

    function addMargin(address _account, uint256 _amount) external onlyMarket {
        userMargin[_account] += _amount.toInt256();
    }

    function removeMargin(
        address _account,
        uint256 _amount
    ) external onlyMarket {
        userMargin[_account] -= _amount.toInt256();
    }

    function updatePosition(
        address _account,
        address _token,
        int256 _size,
        int256 _avgPrice
    ) external onlyMarket {
        Position storage position = userPositions[_account][_token];
        position.size = _size;
        position.avgPrice = _avgPrice;
        position.accFunding = feeInfos[_token].accFunding;
        position.accFinancingFee = position.size > 0
            ? feeInfos[_token].accLongFinancingFee
            : feeInfos[_token].accShortFinancingFee;
    }

    function updateGlobalPosition(
        address _token,
        int256 _sizeDelta,
        int256 _avgPrice
    ) external onlyMarket {
        GlobalPosition storage position = globalPositions[_token];
        if (_sizeDelta > 0) {
            position.longSize += _sizeDelta;
        } else if (_sizeDelta < 0) {
            position.shortSize += _sizeDelta;
        }
        position.avgPrice = _avgPrice;
        position.accFunding = feeInfos[_token].accFunding;
        position.accLongFinancingFee = feeInfos[_token].accLongFinancingFee;
        position.accShortFinancingFee = feeInfos[_token].accShortFinancingFee;
    }

    function updateTokenInfo(
        address _token,
        TokenInfo memory _tokenInfo
    ) external onlyMarket {
        tokenInfos[_token] = _tokenInfo;
    }

    /*=== perp ===*/
    function marketKey(address _token) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(_token, PERP_DOMAIN));
    }

    /**
     * @notice get the current skew of a market(in underlying size)
     * @param _token token address
     */
    function currentSkew(address _token) public view returns (int256) {
        GlobalPosition storage globalPosition = globalPositions[_token];
        return -(globalPosition.longSize + globalPosition.shortSize);
    }

    /*=== trading ===*/

    /**
     * @dev calculate price coefficient when trade _size on _skew.
     *      Here _size and _skew have the same sign.
     *      avgPrice = priceCoefficient * oraclePrice
     */
    function _computePriceCoefficient(
        int _skew,
        int _size,
        int _kLP,
        int _lambda
    ) internal pure returns (int priceCoefficient) {
        if (_skew.abs() >= _kLP) {
            priceCoefficient = (_UNIT + (_skew > 0 ? _lambda : -_lambda));
        } else if ((_skew + _size).abs() <= _kLP) {
            priceCoefficient = (_UNIT +
                (_skew + _size / 2).divideDecimal(_kLP).multiplyDecimal(
                    _lambda
                ));
        } else {
            // |skew| < kLP, |skew + size| > kLP
            int kLPSigned = _skew + _size > 0 ? _kLP : -_kLP;
            int numerator = (_UNIT +
                (_skew + kLPSigned).divideDecimal(2 * _kLP).multiplyDecimal(
                    _lambda
                )).multiplyDecimal(kLPSigned - _skew);
            numerator += (_UNIT + (_skew + _size > 0 ? _lambda : -_lambda))
                .multiplyDecimal(_skew + _size - kLPSigned);
            priceCoefficient = numerator.divideDecimal(_size);
        }
    }

    function computePerpFillPriceRaw(
        int256 _skew,
        int256 _size,
        int256 _oraclePrice,
        int256 _kLP,
        int256 _lambda
    ) public pure returns (int256 avgPrice) {
        require(_kLP > 0, "PerpTracker: non-positive kLP");

        if ((_skew >= 0 && _size >= 0) || (_skew <= 0 && _size <= 0)) {
            // trade direction is the same as skew
            avgPrice = _computePriceCoefficient(_skew, _size, _kLP, _lambda)
                .multiplyDecimal(_oraclePrice);
        } else if (
            (_skew >= 0 && _skew + _size >= 0) ||
            (_skew <= 0 && _skew + _size <= 0)
        ) {
            // trade direction is different from skew but won't flip skew
            avgPrice = _oraclePrice;
        } else {
            // trade direction is different from skew and will flip skew
            int numerator = _oraclePrice.multiplyDecimal(_skew.abs());
            numerator += _computePriceCoefficient(
                0,
                _skew + _size,
                _kLP,
                _lambda
            ).multiplyDecimal((_skew + _size).abs());
            avgPrice = numerator.divideDecimal(_size.abs()).multiplyDecimal(
                _oraclePrice
            );
        }
    }

    /**
     * @notice compute the fill price of a trade
     * @dev premium = lambda * clamp(skew / (k * LP / price), -1, 1)
     *      fill price is the average price of trading _size at current market
     * @param _token token to trade
     * @param _size trade size, positive for long, negative for short
     * @param _oraclePrice oracle price
     * @param _lpNetValue lp net value
     * @return avgPrice the fill price
     */
    function computePerpFillPrice(
        address _token,
        int256 _size,
        int256 _oraclePrice,
        int256 _lpNetValue
    ) external view returns (int256 avgPrice) {
        MarketSettings settings_ = MarketSettings(settings);

        int lambda = settings_
            .getUintValsByMarket(marketKey(_token), LAMBDA_PREMIUM)
            .toInt256();
        int skew = currentSkew(_token);
        int kLP = settings_.getUintVals(K_LP_SENSITIVITY).toInt256();
        kLP = kLP.multiplyDecimal(_lpNetValue).divideDecimal(_oraclePrice);

        return computePerpFillPriceRaw(skew, _size, _oraclePrice, kLP, lambda);
    }

    function computeTrade(
        int256 _size,
        int256 _avgPrice,
        int256 _accFunding,
        int256 _sizeDelta,
        int256 _price,
        int256 _latestAccFunding
    ) external pure returns (int256 nextPrice, int256 pnlAndFunding) {
        int256 nextSize = _size + _sizeDelta;
        if ((_sizeDelta > 0 && _size >= 0) || (_sizeDelta < 0 && _size <= 0)) {
            // increase position
            nextPrice = ((_size * _avgPrice + _sizeDelta * _price) / nextSize)
                .abs();
        } else {
            // decrease position
            // here _size must be non-zero
            if ((nextSize > 0 && _size > 0) || (nextSize < 0 && _size < 0)) {
                // position direction is not changed
                pnlAndFunding = (_size - nextSize).multiplyDecimal(
                    _price - _avgPrice
                );
                nextPrice = _avgPrice;
            } else {
                // position direction changed
                pnlAndFunding = _size.multiplyDecimal(_price - _avgPrice);
                nextPrice = _price;
            }
        }
        // funding
        pnlAndFunding -= (_latestAccFunding - _accFunding).multiplyDecimal(
            _size
        );
    }

    /*=== funding & financing fees ===*/

    /**
     * @dev compute funding velocity:
     * v = min{max{-1, skew / L}, 1} * v_max
     * @param _token token address
     */
    function _fundingVelocity(
        address _token
    ) internal view returns (int256 velocity) {
        MarketSettings settings_ = MarketSettings(settings);

        int numerator = tokenInfos[_token].skew;
        int256 lp = tokenInfos[_token].lpNetValue;
        int denominator = settings_
            .getUintVals(K_LP_SENSITIVITY)
            .toInt256()
            .multiplyDecimal(lp);
        // max velocity
        int256 maxVelocity = settings_
            .getUintValsByMarket(marketKey(_token), MAX_FUNDING_VELOCITY)
            .toInt256();
        if (denominator > 0) {
            return
                numerator
                    .divideDecimal(denominator)
                    .max(-_UNIT)
                    .min(_UNIT)
                    .multiplyDecimal(maxVelocity);
        }
        return numerator > 0 ? maxVelocity : -maxVelocity;
    }

    /**
     * @dev compute the current funding rate based on funding velocity
     * @param _token token address
     */
    function _nextFundingRate(
        address _token
    )
        internal
        view
        returns (
            int256 nextFundingRate,
            int256 latestFundingRate,
            int256 timeElapsed
        )
    {
        // get latest funding rate
        latestFundingRate = feeInfos[_token].fundingRate;
        // get funding rate velocity
        int256 fundingVelocity = _fundingVelocity(_token);
        // get time epalsed (normalized to days)
        timeElapsed = (int(block.timestamp) - feeInfos[_token].updateTime)
            .max(0)
            .divideDecimal(1 days);
        // next funding rate
        nextFundingRate =
            latestFundingRate +
            fundingVelocity.multiplyDecimal(timeElapsed);
    }

    /**
     * @dev compute next accumulate funding delta
     * @param _token token address
     * @param _price base asset price
     * @return nextFundingRate, nextAccFunding
     */
    function nextAccFunding(
        address _token,
        int256 _price
    ) public view returns (int256, int256) {
        if (feeInfos[_token].updateTime >= int(block.timestamp)) {
            return (feeInfos[_token].fundingRate, feeInfos[_token].accFunding);
        }
        // compute next funding rate
        (
            int nextFundingRate,
            int256 latestFundingRate,
            int256 timeElapsed
        ) = _nextFundingRate(_token);
        int accFundingDelta = ((nextFundingRate + latestFundingRate) / 2)
            .multiplyDecimal(timeElapsed)
            .multiplyDecimal(_price);
        return (nextFundingRate, feeInfos[_token].accFunding + accFundingDelta);
    }

    /**
     * @dev get current soft limit, if open interest > soft limit, financing fee will be charged
     *      soft_limit = min(lp_net_value * threshold, max_soft_limit)
     */
    function lpSoftLimit(int256 lp) public view returns (int) {
        int maxSoftLimit = MarketSettings(settings)
            .getUintVals(MAX_SOFT_LIMIT)
            .toInt256();
        int threshold = MarketSettings(settings)
            .getUintVals(SOFT_LIMIT_THRESHOLD)
            .toInt256();
        return lp.multiplyDecimal(threshold).min(maxSoftLimit);
    }

    /**
     * @dev get current hard limit
     */
    function lpHardLimit(int256 lp) public view returns (int) {
        int threshold = MarketSettings(settings)
            .getUintVals(HARD_LIMIT_THRESHOLD)
            .toInt256();
        return lp.multiplyDecimal(threshold);
    }

    function nextAccFinancingFee(
        address _token,
        int256 _price
    )
        public
        view
        returns (int nextAccLongFinancingFee, int nextAccShortFinancingFee)
    {
        MarketSettings settings_ = MarketSettings(settings);

        (nextAccLongFinancingFee, nextAccShortFinancingFee) = (
            feeInfos[_token].accLongFinancingFee,
            feeInfos[_token].accShortFinancingFee
        );
        if (feeInfos[_token].updateTime >= int(block.timestamp)) {
            return (nextAccLongFinancingFee, nextAccShortFinancingFee);
        }
        // check soft limit
        int oi = tokenInfos[_token].netOpenInterest;
        int lp = tokenInfos[_token].lpNetValue;
        if (oi > lpSoftLimit(lp)) {
            // charge fee from the larger side
            int feeDelta = 0;
            {
                int256 timeElapsed = (int(block.timestamp) -
                    feeInfos[_token].updateTime).max(0).divideDecimal(1 days);
                // fee rate = min(OI * |skew| / (kLP * hard_limit), 1) * max_fee_rate
                int skew = tokenInfos[_token].skew;
                int numerator = oi.multiplyDecimal(skew);
                int denominator = settings_
                    .getUintVals(K_LP_SENSITIVITY)
                    .toInt256()
                    .multiplyDecimal(lp)
                    .multiplyDecimal(lpHardLimit(lp));

                int256 maxFeeRate = settings_
                    .getUintVals(MAX_FINANCING_FEE_RATE)
                    .toInt256();
                int256 feeRate = denominator > 0
                    ? numerator
                        .divideDecimal(denominator)
                        .min(_UNIT)
                        .multiplyDecimal(maxFeeRate)
                    : maxFeeRate;
                feeDelta = feeRate.multiplyDecimal(timeElapsed).multiplyDecimal(
                    _price
                );
            }
            if (feeDelta > 0) {
                (int longSize, int shortSize) = (
                    -globalPositions[_token].shortSize,
                    -globalPositions[_token].longSize
                );
                if (longSize > -shortSize) {
                    nextAccLongFinancingFee += feeDelta;
                } else {
                    nextAccShortFinancingFee += feeDelta;
                }
            }
        }
    }

    function updateFee(address _token, int256 _price) external onlyMarket {
        // get latest funding rate and accumulate funding delta
        (int nextFundingRate, int nextAccFundingFee) = nextAccFunding(
            _token,
            _price
        );
        (
            int nextAccLongFinancingFee,
            int nextAccShortFinancingFee
        ) = nextAccFinancingFee(_token, _price);

        feeInfos[_token] = FeeInfo(
            nextAccFundingFee,
            nextFundingRate,
            nextAccLongFinancingFee,
            nextAccShortFinancingFee,
            int(block.timestamp)
        );
    }
}
