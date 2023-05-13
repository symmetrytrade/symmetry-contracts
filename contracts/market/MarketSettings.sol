// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../utils/Initializable.sol";
import "../interfaces/IMarketSettings.sol";

/**
 * @dev Contract module which holds the setting params for all markets.
 */
contract MarketSettings is IMarketSettings, Ownable, Initializable {
    mapping(bytes32 => int) private intVals;

    function initialize() external onlyInitializeOnce {
        _transferOwnership(msg.sender);
    }

    /*=== setters ===*/

    function setIntVals(bytes32 _key, int _value) external onlyOwner {
        intVals[_key] = _value;

        emit SetKey(_key, _value);
    }

    /*=== getters ===*/

    function getIntVals(bytes32 _key) external view returns (int) {
        return intVals[_key];
    }

    function getIntValsByMarket(bytes32 _marketKey, bytes32 _key) external view returns (int) {
        return intVals[keccak256(abi.encodePacked([_marketKey, _key]))];
    }
}
