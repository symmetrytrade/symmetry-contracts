// SPDX-License-Identifier: MIT

pragma solidity ^0.8.2;

contract CommonContext {
    // same unit in SafeDeicmalMath and SignedSafeDeicmalMath
    int256 internal constant _UNIT = int(10 ** 18);

    function _startOfDay(uint256 _t) internal pure returns (uint256) {
        return (_t / 1 days) * 1 days;
    }

    function _startOfWeek(uint256 _t) internal pure returns (uint256) {
        return (_t / 1 weeks) * 1 weeks;
    }
}
