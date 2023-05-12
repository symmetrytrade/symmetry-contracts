// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

library SafeDecimalMath {
    uint8 public constant DECIMALS = 18;
    uint public constant UNIT = 10 ** DECIMALS;

    function unit() external pure returns (uint) {
        return UNIT;
    }

    function multiplyDecimal(uint x, uint y) internal pure returns (uint) {
        return (x * y) / UNIT;
    }

    function divideDecimal(uint x, uint y) internal pure returns (uint) {
        return (x * UNIT) / y;
    }

    function min(uint x, uint y) internal pure returns (uint) {
        return x < y ? x : y;
    }

    function max(uint x, uint y) internal pure returns (uint) {
        return x < y ? y : x;
    }
}

library SignedSafeDecimalMath {
    uint8 public constant DECIMALS = 18;
    int public constant UNIT = int(10 ** DECIMALS);

    function unit() external pure returns (int) {
        return UNIT;
    }

    function multiplyDecimal(int x, int y) internal pure returns (int) {
        return (x * y) / UNIT;
    }

    function divideDecimal(int x, int y) internal pure returns (int) {
        return (x * UNIT) / y;
    }

    function sign(int x) internal pure returns (int) {
        if (x > 0) return UNIT;
        if (x < 0) return -UNIT;
        return 0;
    }

    function abs(int x) internal pure returns (int) {
        return x < 0 ? -x : x;
    }

    function min(int x, int y) internal pure returns (int) {
        return x < y ? x : y;
    }

    function max(int x, int y) internal pure returns (int) {
        return x < y ? y : x;
    }
}
