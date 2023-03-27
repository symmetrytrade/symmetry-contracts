// SPDX-License-Identifier: MIT
pragma solidity ^0.8.2;

library SafeDecimalMath {
    uint8 public constant DECIMALS = 18;
    uint256 public constant UNIT = 10 ** DECIMALS;

    function unit() external pure returns (uint256) {
        return UNIT;
    }

    function multiplyDecimal(
        uint256 x,
        uint256 y
    ) internal pure returns (uint256) {
        return (x * y) / UNIT;
    }

    function divideDecimal(
        uint256 x,
        uint256 y
    ) internal pure returns (uint256) {
        return (x * UNIT) / y;
    }

    function min(uint256 x, uint256 y) internal pure returns (uint256) {
        return x < y ? x : y;
    }

    function max(uint256 x, uint256 y) internal pure returns (uint256) {
        return x < y ? y : x;
    }
}

library SignedSafeDecimalMath {
    uint8 public constant DECIMALS = 18;
    int256 public constant UNIT = int(10 ** DECIMALS);

    function unit() external pure returns (int256) {
        return UNIT;
    }

    function multiplyDecimal(
        int256 x,
        int256 y
    ) internal pure returns (int256) {
        return (x * y) / UNIT;
    }

    function divideDecimal(int256 x, int256 y) internal pure returns (int256) {
        return (x * UNIT) / y;
    }

    function sign(int256 x) internal pure returns (int256) {
        if (x > 0) return UNIT;
        if (x < 0) return -UNIT;
        return 0;
    }

    function abs(int256 x) internal pure returns (int256) {
        return x < 0 ? -x : x;
    }

    function min(int256 x, int256 y) internal pure returns (int256) {
        return x < y ? x : y;
    }

    function max(int256 x, int256 y) internal pure returns (int256) {
        return x < y ? y : x;
    }
}
