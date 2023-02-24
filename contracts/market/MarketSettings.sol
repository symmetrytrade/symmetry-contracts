// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../access/Ownable.sol";
import "../utils/Initializable.sol";

/**
 * @dev Contract module which holds the setting params for all markets.
 */
contract MarketSettings is Ownable, Initializable {
    mapping(bytes32 => uint256) private uintVals;

    function initialize() external onlyInitializeOnce {
        _transferOwnership(msg.sender);
    }

    /*=== setters ===*/

    function setUintVals(bytes32 _key, uint256 _value) external onlyOwner {
        uintVals[_key] = _value;
    }

    /*=== getters ===*/

    function getUintVals(bytes32 _key) external view returns (uint256) {
        return uintVals[_key];
    }

    function getUintValsByMarket(
        bytes32 _marketKey,
        bytes32 _key
    ) external view returns (uint256) {
        return uintVals[keccak256(abi.encodePacked([_marketKey, _key]))];
    }
}
