// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISYMRate {
    /*=== struct ===*/

    struct Rate {
        uint256 startTime;
        uint256 rate;
    }

    /*=== function ===*/

    function getSum(
        uint256 start,
        uint256 end
    ) external view returns (uint256 sum);

    function rates(
        uint256
    ) external view returns (uint256 startTime, uint256 rate);
}
