// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IVolumeTracker {
    /*=== struct ===*/

    struct Tier {
        uint256 requirement;
        uint256 rebateRatio;
    }

    /*=== function ===*/

    function claimWeeklyTradingFeeCoupon(uint256 _t) external;

    function coupon() external view returns (address);

    function logTrade(address _account, uint256 _volume) external;

    function market() external view returns (address);

    function rebateTiers(uint256) external view returns (uint256 requirement, uint256 rebateRatio);

    function settings() external view returns (address);

    function userDailyVolume(address, uint256) external view returns (uint256);

    function userWeeklyVolume(address, uint256) external view returns (uint256);
}
