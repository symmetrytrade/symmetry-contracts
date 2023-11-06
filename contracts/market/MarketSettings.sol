// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../utils/Initializable.sol";
import "../interfaces/IMarketSettings.sol";

/**
 * @dev Contract module which holds the setting params for all markets.
 */
contract MarketSettings is IMarketSettings, Ownable, Initializable {
    // reserved storage slots for base contract upgrade in future
    uint256[50] private __gap;

    // states
    mapping(bytes32 => int) private intVals;

    function initialize() external onlyInitializeOnce {
        _transferOwnership(msg.sender);
    }

    /*=== setters ===*/

    function setIntVals(bytes32[] memory _keys, int[] memory _values) external onlyOwner {
        require(_keys.length == _values.length, "MarketSettings: length not match");
        uint len = _keys.length;
        for (uint i = 0; i < len; ++i) {
            intVals[_keys[i]] = _values[i];
            emit SetKey(_keys[i], _values[i]);
        }
    }

    /*=== getters ===*/

    function getIntVals(bytes32 _key) external view returns (int) {
        return intVals[_key];
    }

    function getIntValsByDomain(bytes32 _domainKey, bytes32 _key) external view returns (int) {
        return intVals[keccak256(abi.encodePacked([_domainKey, _key]))];
    }
}
