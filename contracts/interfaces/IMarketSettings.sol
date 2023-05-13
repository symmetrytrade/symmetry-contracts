// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IMarketSettings {
    event SetKey(bytes32 key, int value);

    function setIntVals(bytes32 _key, int _value) external;

    function getIntVals(bytes32 _key) external view returns (int);

    function getIntValsByMarket(bytes32 _marketKey, bytes32 _key) external view returns (int);
}
