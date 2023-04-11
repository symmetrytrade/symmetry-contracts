// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../access/Ownable.sol";
import "../utils/Initializable.sol";

/**
 * @dev Contract module which holds the setting params for all markets.
 */
contract MarketSettings is Ownable, Initializable {
    mapping(bytes32 => int256) private intVals;

    function initialize() external onlyInitializeOnce {
        _transferOwnership(msg.sender);
    }

    /*=== setters ===*/

    function setIntVals(bytes32 _key, int256 _value) external onlyOwner {
        intVals[_key] = _value;
    }

    /*=== getters ===*/

    function getIntVals(bytes32 _key) external view returns (int256) {
        return intVals[_key];
    }

    function getIntValsByMarket(
        bytes32 _marketKey,
        bytes32 _key
    ) external view returns (int256) {
        return intVals[keccak256(abi.encodePacked([_marketKey, _key]))];
    }
}
