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
    bytes32 public constant K_PREMIUM = "kPremium";

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

        _transferOwnership(msg.sender);
    }

    /*=== owner ===*/

    function setMarket(address _market) external onlyOwner {
        market = _market;
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

    function latestFundingRate(address _token) external view returns (int256) {
        return feeInfos[_token].fundingRate;
    }

    function latestAccFinancingFee(
        address _token
    ) external view returns (int256, int256) {
        return (
            feeInfos[_token].accLongFinancingFee,
            feeInfos[_token].accShortFinancingFee
        );
    }

    function latestFeeUpdateTime(
        address _token
    ) external view returns (int256) {
        return feeInfos[_token].updateTime;
    }

    function latestLpNetValue(address _token) external view returns (int256) {
        return tokenInfos[_token].lpNetValue;
    }

    function latestSkew(address _token) external view returns (int256) {
        return tokenInfos[_token].skew;
    }

    function latestNetOpenInterest(
        address _token
    ) external view returns (int256) {
        return tokenInfos[_token].netOpenInterest;
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

    function updateFee(
        address _token,
        FeeInfo memory _feeInfo
    ) external onlyMarket {
        feeInfos[_token] = _feeInfo;
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
            int kLPSigned = _skew > 0 ? _kLP : -_kLP;
            int numerator = (_UNIT +
                (_skew + kLPSigned).divideDecimal(2 * _kLP).multiplyDecimal(
                    _lambda
                )).multiplyDecimal(kLPSigned - _skew);
            numerator += (_UNIT + (_skew > 0 ? _lambda : -_lambda))
                .multiplyDecimal(_skew + _size - kLPSigned);
            priceCoefficient = numerator.divideDecimal(_size);
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
        require(_lpNetValue > 0, "PerpTracker: non-positive lp net value");

        MarketSettings settings_ = MarketSettings(Market(market).settings());

        int lambda = settings_
            .getUintValsByMarket(marketKey(_token), LAMBDA_PREMIUM)
            .toInt256();
        int skew = currentSkew(_token);
        int kLP = settings_
            .getUintValsByMarket(marketKey(_token), K_PREMIUM)
            .toInt256();
        kLP = kLP.multiplyDecimal(_lpNetValue).divideDecimal(_oraclePrice);

        if ((skew >= 0 && _size >= 0) || (skew <= 0 && _size <= 0)) {
            // trade direction is the same as skew
            avgPrice = _computePriceCoefficient(skew, _size, kLP, lambda)
                .multiplyDecimal(_oraclePrice);
        } else if (
            (skew >= 0 && skew + _size >= 0) || (skew <= 0 && skew + _size <= 0)
        ) {
            // trade direction is different from skew but won't flip skew
            avgPrice = _computePriceCoefficient(
                skew + _size,
                -_size,
                kLP,
                lambda
            ).multiplyDecimal(_oraclePrice);
        } else {
            // trade direction is different from skew and will flip skew
            int numerator = _computePriceCoefficient(0, skew, kLP, lambda)
                .multiplyDecimal(skew.abs());
            numerator += _computePriceCoefficient(0, skew + _size, kLP, lambda)
                .multiplyDecimal((skew + _size).abs());
            avgPrice = numerator.divideDecimal(_size.abs()).multiplyDecimal(
                _oraclePrice
            );
        }
    }

    /// @notice compute the fill price of a trade
    /// @param _token token to trade
    /// @param _size trade size, positive for long, negative for short
    /// @param _oraclePrice oracle price
    /// @return the fill price
    function computePerpFillPrice(
        address _token,
        int256 _size,
        int256 _oraclePrice
    ) external view returns (int256) {
        // a temporary implementation based on global skew
        int globalSkew = currentSkew(_token);

        MarketSettings settings_ = MarketSettings(Market(market).settings());
        int256 skewScale = settings_
            .getUintValsByMarket(marketKey(_token), SKEW_SCALE)
            .toInt256();

        int pdBefore = globalSkew.divideDecimal(skewScale);
        int pdAfter = (globalSkew + _size).divideDecimal(skewScale);
        int priceBefore = _oraclePrice + _oraclePrice.multiplyDecimal(pdBefore);
        int priceAfter = _oraclePrice + _oraclePrice.multiplyDecimal(pdAfter);

        return (priceBefore + priceAfter) / 2;
    }
}
