// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IVolumeTracker {
    /*=== struct ===*/

    struct Tier {
        uint requirement;
        uint rebateRatio;
    }

    /*=== function ===*/

    function claimWeeklyTradingFeeCoupon(uint _t) external;

    function coupon() external view returns (address);

    function logTrade(address _account, uint _volume) external;

    function market() external view returns (address);

    function rebateTiers(uint) external view returns (uint requirement, uint rebateRatio);

    function settings() external view returns (address);

    function userDailyVolume(address, uint) external view returns (uint);

    function userWeeklyVolume(address, uint) external view returns (uint);
}
