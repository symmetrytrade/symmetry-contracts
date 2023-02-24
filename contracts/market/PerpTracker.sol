// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../access/Ownable.sol";
import "./Market.sol";

contract PerpTracker is Ownable {
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
    mapping(address => uint256[]) private userPositions; // positions of single user
    mapping(uint256 => Position) private positions; // positions
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

    /* === view functions === */

    function getGlobalPosition(
        address token
    ) external view returns (GlobalPosition memory) {
        return globalPositions[token];
    }

    function marketTokensLength() external view returns (uint256) {
        return marketTokensList.length;
    }

    function getUserPositions(
        address _account
    ) external view returns (uint256[] memory) {
        return userPositions[_account];
    }

    function getPosition(uint256 _id) external view returns (Position memory) {
        return positions[_id];
    }

    /* === update functions ===*/

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
        uint256 _id,
        int256 _size,
        uint256 _avgPrice
    ) external onlyMarket {
        positions[_id].size = _size;
        positions[_id].avgPrice = _avgPrice;
    }
}
