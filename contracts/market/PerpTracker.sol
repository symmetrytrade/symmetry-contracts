// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../access/Ownable.sol";
import "../utils/SafeDecimalMath.sol";
import "./Market.sol";
import "./MarketSettings.sol";

contract PerpTracker is Ownable {
    using SignedSafeDecimalMath for int256;

    // setting keys
    bytes32 internal constant PERP_DOMAIN = "perpDomain";
    bytes32 internal constant SKEW_SCALE = "skewScale";

    struct GlobalPosition {
        int256 longSize; // in underlying, positive, 18 decimals
        int256 shortSize; // in underlying, negative, 18 decimals
        int256 avgPrice; // average price for the net position (long + short)
    }

    struct Position {
        address account;
        address token;
        uint256 id; // position id
        int256 size; // position size, positive for long, negative for short, 18 decimals
        uint256 avgPrice;
    }

    address public market;
    address[] public marketTokensList; // market tokens
    mapping(address => bool) public marketTokensListed;

    mapping(address => GlobalPosition) public globalPositions; // user global positions
    mapping(address => mapping(address => Position)) private userPositions; // positions of single user, user => token => position mapping
    mapping(address => uint256) public userMargin; // margin of user

    modifier onlyMarket() {
        require(msg.sender == market, "PerpTracker: sender is not market");
        _;
    }

    function setMarket(address _market) external onlyOwner {
        market = _market;
    }

    /* === Token Management === */

    function setMarketToken(address _token) external onlyOwner {
        if (!marketTokensListed[_token]) {
            marketTokensListed[_token] = true;
            marketTokensList.push(_token);
        }
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

    /*=== update functions ===*/

    function addMargin(address _account, uint256 _amount) external onlyMarket {
        userMargin[_account] += _amount;
    }

    function removeMargin(
        address _account,
        uint256 _amount
    ) external onlyMarket {
        uint256 currentMargin = userMargin[_account];
        require(currentMargin >= _amount, "PerpTracker: insufficient margin");
        userMargin[_account] -= _amount;
    }

    function updatePosition(
        address _account,
        address _token,
        int256 _size,
        uint256 _avgPrice
    ) external onlyMarket {
        Position storage position = userPositions[_account][_token];
        position.size = _size;
        position.avgPrice = _avgPrice;
    }

    /*=== perp ===*/
    function marketKey(address _token) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(_token, PERP_DOMAIN));
    }

    /// @notice compute the fill price of a trade
    /// @param _token token to trade
    /// @param _size trade size, positive for long, negative for short
    /// @param _oraclePrice oracle price
    /// @return the fill price
    function computePerpFillPrice(
        address _token,
        int256 _size,
        uint256 _oraclePrice
    ) external view returns (uint256) {
        // a temporary implementation based on global skew
        GlobalPosition storage globalPosition = globalPositions[_token];
        int globalSkew = globalPosition.longSize + globalPosition.shortSize;

        MarketSettings settings_ = MarketSettings(Market(market).settings());
        int256 skewScale = int(
            settings_.getUintValsByMarket(marketKey(_token), SKEW_SCALE)
        );

        int pdBefore = globalSkew.divideDecimal(skewScale);
        int pdAfter = (globalSkew + _size).divideDecimal(skewScale);
        int priceBefore = int(_oraclePrice) +
            int(_oraclePrice).multiplyDecimal(pdBefore);
        int priceAfter = int(_oraclePrice) +
            int(_oraclePrice).multiplyDecimal(pdAfter);

        return uint(priceBefore + priceAfter) / 2;
    }
}
