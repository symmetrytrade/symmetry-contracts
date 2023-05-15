// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IFeeTracker {
    /*=== struct ===*/

    struct Tier {
        uint portion; // veSYM holding portion
        uint discount; // discount percent
    }

    /*=== functions ===*/

    function claimIncentives(uint[] calldata _ts) external;

    function claimed(address, uint) external view returns (bool);

    function coupon() external view returns (address);

    function discountedTradingFee(
        address _account,
        int _sizeDelta,
        int _price,
        bool _useCoupon
    ) external returns (int, uint, uint);

    function distributeIncentives(uint _fee) external;

    function liquidationFee(int notional) external view returns (int);

    function liquidationPenalty(int notional) external view returns (int);

    function market() external view returns (address);

    function perpTracker() external view returns (address);

    function redeemTradingFee(address _account, int lp, int redeemValue) external returns (uint fee);

    function settings() external view returns (address);

    function tradingFeeIncentives(uint) external view returns (uint);

    function tradingFeeTiers(uint) external view returns (uint portion, uint discount);

    function votingEscrow() external view returns (address);
}
