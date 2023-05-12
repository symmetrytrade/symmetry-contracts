// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IMarketSettings {
    function setIntVals(bytes32 _key, int256 _value) external;

    function getIntVals(bytes32 _key) external view returns (int256);

    function getIntValsByMarket(bytes32 _marketKey, bytes32 _key) external view returns (int256);
}
