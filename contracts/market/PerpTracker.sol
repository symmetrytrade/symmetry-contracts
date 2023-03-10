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

    struct GlobalPosition {
        int256 longSize; // in underlying, positive, 18 decimals
        int256 shortSize; // in underlying, negative, 18 decimals
        int256 avgPrice; // average price for the net position (long + short)
        int256 accFunding; // accumulate funding fee for unit position size at the time of latest open/close position or lp in/out
    }

    struct Position {
        address account;
        address token;
        int256 size; // position size, positive for long, negative for short, 18 decimals
        int256 accFunding; // accumulate funding fee for unit position size at the latest position modification
        int256 accOIFee; // accumulate open interest fee for unit position size at the latest position modification
        int256 avgPrice;
    }

    struct FeeInfo {
        int256 accFunding; // the latest accumulate funding fee for unit position size
        int256 fundingRate; // the latest funding rate
        int256 accLongOIFee; // the latest open interest fee for long positions
        int256 accShortOIFee; // the latest open interest fee for short positions
        int256 updateTime; // the latest fee update time
    }

    struct GlobalInfo {
        int256 lpNetValue; // latest lp net value
        int256 longOpenInterest; // latest open interest of long positions
        int256 shortOpenInterest; // latest open interest of short positions
    }

    address public market;
    address[] public marketTokensList; // market tokens
    mapping(address => bool) public marketTokensListed;

    mapping(address => GlobalPosition) public globalPositions; // lp global positions
    mapping(address => mapping(address => Position)) private userPositions; // positions of single user, user => token => position mapping
    mapping(address => int256) public userMargin; // margin(include realized pnl) of user

    mapping(address => FeeInfo) private feeInfos;
    mapping(address => GlobalInfo) private globalInfos;

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
    }

    /*=== view functions === */

    function getGlobalPosition(
        address token
    ) external view returns (GlobalPosition memory) {
        return globalPositions[token];
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

    function latestAccOIFee(
        address _token
    ) external view returns (int256, int256) {
        return (feeInfos[_token].accLongOIFee, feeInfos[_token].accShortOIFee);
    }

    function latestFeeUpdateTime(
        address _token
    ) external view returns (int256) {
        return feeInfos[_token].updateTime;
    }

    function latestLpNetValue(address _token) external view returns (int256) {
        return globalInfos[_token].lpNetValue;
    }

    function latestOpenInterest(
        address _token
    ) external view returns (int256, int256) {
        return (
            globalInfos[_token].longOpenInterest,
            globalInfos[_token].shortOpenInterest
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
        if (_size > 0) {
            position.accOIFee = feeInfos[_token].accLongOIFee;
        } else {
            position.accOIFee = feeInfos[_token].accShortOIFee;
        }
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
    }

    function updateFee(
        address _token,
        FeeInfo memory _feeInfo
    ) external onlyMarket {
        feeInfos[_token] = _feeInfo;
    }

    function updateGlobalInfo(
        address _token,
        GlobalInfo memory _globalInfo
    ) external onlyMarket {
        globalInfos[_token] = _globalInfo;
    }

    /*=== perp ===*/
    function marketKey(address _token) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(_token, PERP_DOMAIN));
    }

    /**
     * @notice get the current skew of a market(in underlying size)
     * @param _token token address
     */
    function currentSkew(address _token) external view returns (int256) {
        GlobalPosition storage globalPosition = globalPositions[_token];
        return -(globalPosition.longSize + globalPosition.shortSize);
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
        GlobalPosition storage globalPosition = globalPositions[_token];
        int globalSkew = globalPosition.longSize + globalPosition.shortSize;

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
