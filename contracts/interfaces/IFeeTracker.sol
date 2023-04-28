// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IFeeTracker {
    /*=== struct ===*/

    struct Tier {
        uint256 portion; // veSYM holding portion
        uint256 discount; // discount percent
    }

    /*=== functions ===*/

    function claimIncentives(uint256[] calldata _ts) external;

    function claimed(address, uint256) external view returns (bool);

    function coupon() external view returns (address);

    function discountedTradingFee(
        address _account,
        int256 _sizeDelta,
        int256 _price
    ) external returns (int256, uint256, uint256);

    function distributeIncentives(uint256 _fee) external;

    function liquidationFee(int256 notional) external view returns (int256);

    function liquidationPenalty(int256 notional) external view returns (int256);

    function market() external view returns (address);

    function perpTracker() external view returns (address);

    function redeemTradingFee(
        address _account,
        int256 lp,
        int256 redeemValue
    ) external returns (uint256 fee);

    function settings() external view returns (address);

    function tradingFeeIncentives(uint256) external view returns (uint256);

    function tradingFeeTiers(
        uint256
    ) external view returns (uint256 portion, uint256 discount);

    function votingEscrow() external view returns (address);
}
