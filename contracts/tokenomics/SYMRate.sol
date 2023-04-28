// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "../interfaces/ISYMRate.sol";

contract SYMRate is ISYMRate, Ownable {
    // release rate in seconds
    Rate[] public rates;

    constructor() {}

    function changeRate(Rate[] calldata _rates) external onlyOwner {
        require(_rates.length > 0, "SYMRate: empty rate");
        require(_rates[_rates.length - 1].rate == 0, "SYMRate: never end");
        delete rates;
        uint256 t = 0;
        for (uint256 i = 0; i < _rates.length; ++i) {
            require(_rates[i].startTime > t, "SYMRate: invalid");
            t = _rates[i].startTime;
            rates.push(_rates[i]);
        }
    }

    function getSum(
        uint256 start,
        uint256 end
    ) external view returns (uint256 sum) {
        uint256 len = rates.length;
        sum = 0;
        for (uint256 i = 0; i < len; ++i) {
            if (i + 1 < len && start >= rates[i + 1].startTime) continue;
            uint256 l = rates[i].startTime;
            if (end <= l) break;
            if (l < start) l = start;
            uint256 r = end;
            if (i + 1 < len && rates[i + 1].startTime < r) {
                r = rates[i + 1].startTime;
            }
            sum = sum + rates[i].rate * (r - l);
        }
    }
}
