// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ILiquidityGauge {
    /*=== struct ===*/

    // user info
    struct UserInfo {
        uint amount; // Amount of tokens the user staked.
        uint workingPower; // boosted user share.
        uint rewardPerShare; // Accumulated reward per share.
    }

    /*=== event ===*/
    event Deposit(address indexed user, uint amount);
    event Withdraw(address indexed user, uint amount);
    event UpdateWorkingPower(address indexed user, uint workingPower);

    /*=== function ===*/
    function symRate() external view returns (address);

    function accRewardPerShare() external view returns (uint256);

    function deposit(uint256 _amount) external returns (uint256);

    function depositAfterMint(address _account, uint256 _amount) external returns (uint256 reward);

    function k() external view returns (uint256);

    function lastRewardTime() external view returns (uint256);

    function lpToken() external view returns (address);

    function token() external view returns (address);

    function totalStaked() external view returns (uint256);

    function totalWorkingPower() external view returns (uint256);

    function update() external;

    function userInfo(address) external view returns (uint256 amount, uint256 workingPower, uint256 rewardPerShare);

    function votingEscrow() external view returns (address);

    function withdraw(uint256 _amount) external returns (uint256 reward);
}
