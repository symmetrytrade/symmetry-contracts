// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

import "../utils/SafeDecimalMath.sol";
import "../utils/Initializable.sol";
import "../utils/CommonContext.sol";

import "../interfaces/IMarket.sol";
import "../interfaces/IMarketSettings.sol";
import "../interfaces/IPerpTracker.sol";
import "../interfaces/IPriceOracle.sol";

import "./MarketSettingsContext.sol";

contract PerpTracker is IPerpTracker, CommonContext, MarketSettingsContext, Ownable, Initializable {
    using SignedSafeDecimalMath for int;
    using SafeCast for uint;
    using SafeCast for int;

    // reserved storage slots for base contract upgrade in future
    uint256[50] private __gap;

    // states
    address public market;
    address public settings;
    address[] public marketTokensList; // market tokens
    mapping(address => bool) public marketTokensListed;

    mapping(address => LpPosition) public lpPositions; // lp global positions
    mapping(address => mapping(address => Position)) private userPositions; // positions of single user, user => token => position mapping
    mapping(address => int) public userMargin; // margin(include realized pnl) of user

    mapping(address => FeeInfo) private feeInfos;
    mapping(address => TokenInfo) private tokenInfos;

    modifier onlyMarket() {
        require(msg.sender == market, "PerpTracker: sender is not market");
        _;
    }

    /*=== initialize ===*/

    function initialize(address _market) external onlyInitializeOnce {
        market = _market;
        settings = IMarket(_market).settings();

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
            emit NewMarket(_token);
        }
        if (feeInfos[_token].updateTime == 0) feeInfos[_token].updateTime = int(block.timestamp);
    }

    function removeToken(uint _tokenIndex) external onlyOwner {
        uint len = marketTokensList.length;
        require(len > _tokenIndex, "PerpTracker: token index out of bound");
        address token = marketTokensList[_tokenIndex];
        delete marketTokensListed[token];
        marketTokensList[_tokenIndex] = marketTokensList[len - 1];
        marketTokensList.pop();
        emit RemoveMarket(token);
    }

    /*=== view functions === */

    function getTokenInfo(address _token) external view returns (TokenInfo memory) {
        return tokenInfos[_token];
    }

    function getFeeInfo(address _token) external view returns (FeeInfo memory) {
        return feeInfos[_token];
    }

    function getLpPosition(address _token) external view returns (LpPosition memory) {
        return lpPositions[_token];
    }

    /**
     * @notice get user net position of a token
     * @return long position size, short position size
     */
    function getNetPositionSize(address _token) external view returns (int, int) {
        return (-lpPositions[_token].shortSize, -lpPositions[_token].longSize);
    }

    function marketTokensLength() external view returns (uint) {
        return marketTokensList.length;
    }

    function getPosition(address _account, address _token) external view returns (Position memory) {
        return userPositions[_account][_token];
    }

    function getPositionSize(address _account, address _token) external view returns (int) {
        return userPositions[_account][_token].size;
    }

    function latestUpdated(address _token) external view returns (uint) {
        return uint(feeInfos[_token].updateTime);
    }

    /*=== update functions ===*/

    function _addMargin(address _account, uint _amount) internal {
        userMargin[_account] += _amount.toInt256();

        emit MarginTransferred(_account, _amount.toInt256());
    }

    function addMargin(address _account, uint _amount) external onlyMarket {
        _addMargin(_account, _amount);
    }

    function _removeMargin(address _account, uint _amount) internal {
        userMargin[_account] -= _amount.toInt256();

        emit MarginTransferred(_account, -(_amount.toInt256()));
    }

    function removeMargin(address _account, uint _amount) external onlyMarket {
        _removeMargin(_account, _amount);
    }

    function _modifyMarginByUsd(address _account, int _amount) internal {
        uint tokenAmount = IMarket(market).usdToToken(IMarket(market).baseToken(), _amount.abs(), false).toUint256();
        if (_amount > 0) {
            _addMargin(_account, tokenAmount);
        } else if (_amount < 0) {
            _removeMargin(_account, tokenAmount);
        }
    }

    function _updatePosition(address _account, address _token, int _sizeDelta, int _avgPrice) internal {
        Position storage position = userPositions[_account][_token];
        position.size += _sizeDelta;
        position.avgPrice = _avgPrice;
        position.accFunding = feeInfos[_token].accFunding;
        position.accFinancingFee = position.size > 0
            ? feeInfos[_token].accLongFinancingFee
            : feeInfos[_token].accShortFinancingFee;

        emit PositionUpdated(_account, _token, position.size, _avgPrice, position.accFunding, position.accFinancingFee);
    }

    function _updateLpPosition(address _token, int _longSizeDelta, int _shortSizeDelta, int _avgPrice) internal {
        LpPosition storage position = lpPositions[_token];
        if (_longSizeDelta != 0) {
            position.longSize += _longSizeDelta;
        }
        if (_shortSizeDelta != 0) {
            position.shortSize += _shortSizeDelta;
        }
        position.avgPrice = _avgPrice;
        position.accFunding = feeInfos[_token].accFunding;
        position.accLongFinancingFee = feeInfos[_token].accLongFinancingFee;
        position.accShortFinancingFee = feeInfos[_token].accShortFinancingFee;
    }

    function updateTokenInfo(address _token, TokenInfo memory _tokenInfo) external onlyMarket {
        tokenInfos[_token] = _tokenInfo;

        emit TokenInfoUpdated(_token, _tokenInfo.lpNetValue, _tokenInfo.netOpenInterest, _tokenInfo.skew);
    }

    /*=== perp ===*/
    function marketKey(address _token) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(_token, PERP_DOMAIN));
    }

    /**
     * @notice get the current skew of a market(in underlying size)
     * @param _token token address
     */
    function currentSkew(address _token) public view returns (int) {
        LpPosition storage lpPosition = lpPositions[_token];
        return -(lpPosition.longSize + lpPosition.shortSize);
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
            priceCoefficient = (_UNIT + (_skew + _size / 2).divideDecimal(_kLP).multiplyDecimal(_lambda));
        } else {
            // |skew| < kLP, |skew + size| > kLP
            int kLPSigned = _skew + _size > 0 ? _kLP : -_kLP;
            int numerator = (_UNIT + (_skew + kLPSigned).divideDecimal(2 * _kLP).multiplyDecimal(_lambda))
                .multiplyDecimal(kLPSigned - _skew);
            numerator += (_UNIT + (_skew + _size > 0 ? _lambda : -_lambda)).multiplyDecimal(_skew + _size - kLPSigned);
            priceCoefficient = numerator.divideDecimal(_size);
        }
    }

    function computePerpFillPriceRaw(
        int _skew,
        int _size,
        int _oraclePrice,
        int _kLP,
        int _lambda
    ) public pure returns (int avgPrice) {
        require(_kLP > 0, "PerpTracker: non-positive kLP");

        if ((_skew >= 0 && _size >= 0) || (_skew <= 0 && _size <= 0)) {
            // trade direction is the same as skew
            avgPrice = _computePriceCoefficient(_skew, _size, _kLP, _lambda).multiplyDecimal(_oraclePrice);
        } else if ((_skew >= 0 && _skew + _size >= 0) || (_skew <= 0 && _skew + _size <= 0)) {
            // trade direction is different from skew but won't flip skew
            avgPrice = _oraclePrice;
        } else {
            // trade direction is different from skew and will flip skew
            int numerator = _UNIT.multiplyDecimal(_skew.abs());
            numerator += _computePriceCoefficient(0, _skew + _size, _kLP, _lambda).multiplyDecimal(
                (_skew + _size).abs()
            );
            avgPrice = numerator.divideDecimal(_size.abs()).multiplyDecimal(_oraclePrice);
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
        int _size,
        int _oraclePrice,
        int _lpNetValue
    ) external view returns (int avgPrice) {
        IMarketSettings settings_ = IMarketSettings(settings);

        int lambda = settings_.getIntVals(MAX_SLIPPAGE);
        int skew = currentSkew(_token);
        int kLP = settings_.getIntValsByMarket(marketKey(_token), PROPORTION_RATIO);
        kLP = kLP.multiplyDecimal(_lpNetValue).divideDecimal(_oraclePrice);

        return computePerpFillPriceRaw(skew, _size, _oraclePrice, kLP, lambda);
    }

    function _computeFinancingFee(address _account, address _token) internal view returns (int) {
        int size = userPositions[_account][_token].size;
        int lastAccFinancingFee = userPositions[_account][_token].accFinancingFee;
        return
            size.abs().multiplyDecimal(
                size > 0
                    ? feeInfos[_token].accLongFinancingFee - lastAccFinancingFee
                    : feeInfos[_token].accShortFinancingFee - lastAccFinancingFee
            );
    }

    function _computeLpFinancingFee(address _token) internal view returns (int financingFee) {
        LpPosition storage position = lpPositions[_token];

        financingFee = (feeInfos[_token].accLongFinancingFee - position.accLongFinancingFee).multiplyDecimal(
            position.shortSize.abs()
        );
        financingFee += (feeInfos[_token].accShortFinancingFee - position.accShortFinancingFee).multiplyDecimal(
            position.longSize
        );
        financingFee = -financingFee;
    }

    function computeTrade(
        int _size,
        int _avgPrice,
        int _sizeDelta,
        int _price
    ) public pure returns (int nextPrice, int pnl) {
        int nextSize = _size + _sizeDelta;
        if ((_sizeDelta > 0 && _size >= 0) || (_sizeDelta < 0 && _size <= 0)) {
            // increase position
            nextPrice = ((_size * _avgPrice + _sizeDelta * _price) / nextSize).abs();
        } else {
            // decrease position
            // here _size must be non-zero
            if ((nextSize > 0 && _size > 0) || (nextSize < 0 && _size < 0)) {
                // position direction is not changed
                pnl = (-_sizeDelta).multiplyDecimal(_price - _avgPrice);
                nextPrice = _avgPrice;
            } else {
                // position direction changed
                pnl = _size.multiplyDecimal(_price - _avgPrice);
                nextPrice = _price;
            }
        }
    }

    function _computeFunding(address _account, address _token) internal view returns (int) {
        return
            (feeInfos[_token].accFunding - userPositions[_account][_token].accFunding).multiplyDecimal(
                userPositions[_account][_token].size
            );
    }

    function _computeLpFunding(address _token) internal view returns (int) {
        return
            (feeInfos[_token].accFunding - lpPositions[_token].accFunding).multiplyDecimal(
                lpPositions[_token].longSize + lpPositions[_token].shortSize
            );
    }

    /**
     * @notice settle trade for user, update position info
     * @return marginDelta margin delta
     * @return oldSize old position size
     * @return newSize new position size
     */
    function settleTradeForUser(
        address _account,
        address _token,
        int _sizeDelta,
        int _execPrice
    ) external onlyMarket returns (int marginDelta, int oldSize, int newSize) {
        marginDelta = -(_computeFunding(_account, _token) + _computeFinancingFee(_account, _token));
        // user position
        Position memory position = userPositions[_account][_token];

        (int nextPrice, int pnl) = computeTrade(position.size, position.avgPrice, _sizeDelta, _execPrice);
        marginDelta += pnl;

        _modifyMarginByUsd(_account, marginDelta);
        _updatePosition(_account, _token, _sizeDelta, nextPrice);

        oldSize = position.size;
        newSize = oldSize + _sizeDelta;
    }

    /**
     * @notice settle trade for lp, update lp position info
     * @param _token token
     * @param _sizeDelta trade volume
     * @param _execPrice execution price
     * @param _oldSize user old position size
     * @param _newSize user position size after trade
     */
    function settleTradeForLp(
        address _token,
        int _sizeDelta,
        int _execPrice,
        int _oldSize,
        int _newSize
    ) external onlyMarket returns (int lpDelta) {
        lpDelta = -(_computeLpFunding(_token) + _computeLpFinancingFee(_token));
        // user position
        LpPosition memory position = lpPositions[_token];

        (int nextPrice, int pnl) = computeTrade(
            position.longSize + position.shortSize,
            position.avgPrice,
            _sizeDelta,
            _execPrice
        );
        lpDelta += pnl;

        int longSizeDelta = 0;
        int shortSizeDelta = 0;
        if (_oldSize > 0) {
            shortSizeDelta += _oldSize;
        } else {
            longSizeDelta += _oldSize;
        }
        if (_newSize > 0) {
            shortSizeDelta -= _newSize;
        } else {
            longSizeDelta -= _newSize;
        }

        _updateLpPosition(_token, longSizeDelta, shortSizeDelta, nextPrice);
        return lpDelta;
    }

    /*=== funding & financing fees ===*/

    function nextFundingVelocity(address _token) external view returns (int) {
        return _fundingVelocity(_token);
    }

    /**
     * @dev compute funding velocity:
     * v = min{max{-1, skew / L}, 1} * v_max
     * @param _token token address
     */
    function _fundingVelocity(address _token) internal view returns (int velocity) {
        IMarketSettings settings_ = IMarketSettings(settings);

        int numerator = tokenInfos[_token].skew;
        if (numerator == 0) return 0;
        int lp = tokenInfos[_token].lpNetValue;
        int denominator = settings_.getIntValsByMarket(marketKey(_token), PROPORTION_RATIO).multiplyDecimal(lp);
        // max velocity
        int maxVelocity = settings_.getIntVals(MAX_FUNDING_VELOCITY);
        if (denominator > 0) {
            return numerator.divideDecimal(denominator).max(-_UNIT).min(_UNIT).multiplyDecimal(maxVelocity);
        }
        return numerator > 0 ? maxVelocity : -maxVelocity;
    }

    /**
     * @dev compute the current funding rate based on funding velocity
     * @param _token token address
     */
    function _nextFundingRate(
        address _token
    ) internal view returns (int nextFundingRate, int avgFundingRate, int timeElapsed) {
        // get latest funding rate
        int latestFundingRate = feeInfos[_token].fundingRate;
        // get funding rate velocity
        int fundingVelocity = _fundingVelocity(_token);
        // get time epalsed (normalized to days)
        timeElapsed = (int(block.timestamp) - feeInfos[_token].updateTime).max(0).divideDecimal(1 days);
        // calculate next funding rate and average funding rate in this period
        if (tokenInfos[_token].skew * latestFundingRate >= 0) {
            // sign of funding rate and skew are the same
            nextFundingRate = latestFundingRate + fundingVelocity.multiplyDecimal(timeElapsed);
            avgFundingRate = (latestFundingRate + nextFundingRate) / 2;
        } else {
            // sign of funding rate and skew are different
            // velocity is doubled until funding rate is flipped
            if ((fundingVelocity * 2).multiplyDecimal(timeElapsed).abs() > latestFundingRate.abs()) {
                // will flip
                int timeToFlip = (-latestFundingRate).divideDecimal(fundingVelocity * 2);
                nextFundingRate = latestFundingRate + fundingVelocity.multiplyDecimal(timeToFlip + timeElapsed);
                avgFundingRate = ((latestFundingRate / 2).multiplyDecimal(timeToFlip) +
                    (nextFundingRate / 2).multiplyDecimal(timeElapsed - timeToFlip)).divideDecimal(timeElapsed);
            } else {
                // won't flip
                nextFundingRate = latestFundingRate + (fundingVelocity * 2).multiplyDecimal(timeElapsed);
                avgFundingRate = (latestFundingRate + nextFundingRate) / 2;
            }
        }
    }

    /**
     * @dev compute next accumulate funding delta
     * @param _token token address
     * @param _price base asset price
     * @return nextFundingRate, nextAccFunding
     */
    function nextAccFunding(address _token, int _price) public view returns (int, int) {
        if (feeInfos[_token].updateTime >= int(block.timestamp)) {
            return (feeInfos[_token].fundingRate, feeInfos[_token].accFunding);
        }
        // compute next funding rate
        (int nextFundingRate, int avgFundingRate, int timeElapsed) = _nextFundingRate(_token);
        int accFundingDelta = avgFundingRate.multiplyDecimal(timeElapsed).multiplyDecimal(_price);
        return (nextFundingRate, feeInfos[_token].accFunding + accFundingDelta);
    }

    /**
     * @dev get current soft limit, if open interest > soft limit, financing fee will be charged
     *      soft_limit = min(lp_net_value * threshold, max_soft_limit)
     */
    function lpSoftLimit(int _lp) public view returns (int) {
        int threshold = IMarketSettings(settings).getIntVals(SOFT_LIMIT_THRESHOLD);
        return _lp.multiplyDecimal(threshold);
    }

    /**
     * @dev get current hard limit
     */
    function lpHardLimit(int _lp) public view returns (int) {
        int threshold = IMarketSettings(settings).getIntVals(HARD_LIMIT_THRESHOLD);
        return _lp.multiplyDecimal(threshold);
    }

    /**
     * @dev get lp limit for token in token size
     */
    function lpLimitForToken(int _lp, address _token) public view returns (int) {
        int threshold = IMarketSettings(settings).getIntVals(TOKEN_OI_LIMIT_RATIO);
        int pr = IMarketSettings(settings).getIntValsByMarket(marketKey(_token), PROPORTION_RATIO);
        int oraclePrice = IPriceOracle(IMarket(market).priceOracle()).getPrice(_token, false);
        return _lp.multiplyDecimal(threshold).multiplyDecimal(pr).divideDecimal(oraclePrice);
    }

    function _nextFinancingFeeRate(address _token) internal view returns (int) {
        IMarketSettings settings_ = IMarketSettings(settings);

        int oi = tokenInfos[_token].netOpenInterest;
        int lp = tokenInfos[_token].lpNetValue;
        int softLimit = lpSoftLimit(lp);
        if (oi > softLimit) {
            // fee rate = min((OI - soft_limit) * |skew| / (pr * LP * hard_limit), 1) * max_fee_rate
            int numerator = (oi - softLimit).multiplyDecimal(tokenInfos[_token].skew.abs());
            if (numerator == 0) return 0;

            int denominator = settings_.getIntValsByMarket(marketKey(_token), PROPORTION_RATIO);
            denominator = denominator.multiplyDecimal(lp).multiplyDecimal(lpHardLimit(lp));

            int maxFeeRate = settings_.getIntVals(MAX_FINANCING_FEE_RATE);
            if (denominator > 0) {
                return numerator.divideDecimal(denominator).min(_UNIT).multiplyDecimal(maxFeeRate);
            }
            return maxFeeRate;
        }
        return 0;
    }

    function nextAccFinancingFee(
        address _token,
        int _price
    ) public view returns (int nextAccLongFinancingFee, int nextAccShortFinancingFee) {
        (nextAccLongFinancingFee, nextAccShortFinancingFee) = (
            feeInfos[_token].accLongFinancingFee,
            feeInfos[_token].accShortFinancingFee
        );
        if (feeInfos[_token].updateTime >= int(block.timestamp)) {
            return (nextAccLongFinancingFee, nextAccShortFinancingFee);
        }
        int rate = _nextFinancingFeeRate(_token);
        if (rate > 0) {
            int timeElapsed = (int(block.timestamp) - feeInfos[_token].updateTime).max(0).divideDecimal(1 days);
            int feeDelta = rate.multiplyDecimal(timeElapsed).multiplyDecimal(_price);
            (int longSize, int shortSize) = (-lpPositions[_token].shortSize, -lpPositions[_token].longSize);
            if (longSize > -shortSize) {
                nextAccLongFinancingFee += feeDelta;
            } else {
                nextAccShortFinancingFee += feeDelta;
            }
        }
    }

    function updateFee(address _token, int _price) external onlyMarket {
        // get latest funding rate and accumulate funding delta
        (int nextFundingRate, int nextAccFundingFee) = nextAccFunding(_token, _price);
        (int nextAccLongFinancingFee, int nextAccShortFinancingFee) = nextAccFinancingFee(_token, _price);

        feeInfos[_token] = FeeInfo(
            nextAccFundingFee,
            nextFundingRate,
            nextAccLongFinancingFee,
            nextAccShortFinancingFee,
            int(block.timestamp)
        );

        emit FeeInfoUpdated(_token, nextFundingRate, nextAccLongFinancingFee, nextAccShortFinancingFee);
    }
}
