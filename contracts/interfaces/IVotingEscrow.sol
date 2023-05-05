// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IVotingEscrow {
    /*=== event ===*/

    event Deposit(
        address indexed provider,
        uint256 value,
        uint256 locktime,
        uint256 lockDuration,
        bool autoExtend,
        LockAction indexed action,
        uint256 ts
    );
    event Withdraw(address indexed provider, uint256 value, uint256 ts);
    event Stake(address indexed provider, uint256 value, uint256 ts);
    event Unstake(address indexed provider, uint256 value, uint256 ts);
    event Vested(address indexed account, uint256 value, uint256 ts);
    event Claimed(address indexed account, uint256 value, uint256 ts);

    /*=== struct ===*/

    struct Point {
        int128 bias;
        int128 slope;
        uint256 ts;
    }

    struct StakedPoint {
        int128 bias;
        int128 slope;
        uint256 ts;
        uint256 end; // timestamp to reach max veSYM
    }

    struct Vest {
        int128 amount;
        uint256 ts;
    }

    struct LockedBalance {
        int128 amount;
        uint256 end; // end of lock, used if autoExtend is false, be zero if autoExtend is true
        uint256 lockDuration; // duration of lock, used if autoExtend is true, be zero if autoExtend is false
        bool autoExtend;
    }

    enum LockAction {
        CREATE_LOCK,
        INCREASE_LOCK_AMOUNT,
        INCREASE_LOCK_TIME
    }

    /*=== function ===*/

    function balanceOf(address _addr) external view returns (uint256);

    function balanceOfAt(
        address _addr,
        uint256 _timestamp
    ) external view returns (uint256);

    function baseToken() external view returns (address);

    function callbackRelayer() external view returns (address);

    function checkpoint() external;

    function claimVested() external;

    function createLock(
        uint256 _value,
        uint256 _unlockTime,
        uint256 _lockDuration,
        bool _autoExtend
    ) external;

    function decimals() external view returns (uint8);

    function getLastStakedPoint(
        address _addr
    ) external view returns (StakedPoint memory point);

    function globalEpoch() external view returns (uint256);

    function increaseLockAmount(uint256 _value) external;

    function increaseLockAmountAndUnlockTime(
        uint256 _value,
        uint256 _unlockTime,
        uint256 _lockDuration,
        bool _autoExtend
    ) external;

    function increaseUnlockTime(
        uint256 _unlockTime,
        uint256 _lockDuration,
        bool _autoExtend
    ) external;

    function locked(
        address
    )
        external
        view
        returns (
            int128 amount,
            uint256 end,
            uint256 lockDuration,
            bool autoExtend
        );

    function lockedBalanceOf(address _addr) external view returns (uint256);

    function lockedBalanceOfAt(
        address _addr,
        uint256 _timestamp
    ) external view returns (uint256);

    function maxTime() external view returns (uint256);

    function name() external view returns (string calldata);

    function pointHistory(
        uint256
    ) external view returns (int128 bias, int128 slope, uint256 ts);

    function slopeChanges(uint256) external view returns (int128);

    function stake(uint256 _value) external;

    function staked(address) external view returns (uint256);

    function stakedBalanceOf(address _addr) external view returns (uint256);

    function stakedBalanceOfAt(
        address _addr,
        uint256 _timestamp
    ) external view returns (uint256);

    function symbol() external view returns (string calldata);

    function totalSupply() external view returns (uint256);

    function totalSupplyAt(uint256 _timestamp) external view returns (uint256);

    function unstake(uint256 _value) external;

    function userClaimEpoch(address) external view returns (uint256);

    function userPointEpoch(address) external view returns (uint256);

    function userPointHistory(
        address,
        uint256
    ) external view returns (int128 bias, int128 slope, uint256 ts);

    function userSlopeChanges(address, uint256) external view returns (int128);

    function userStakedEpoch(address) external view returns (uint256);

    function userStakedHistory(
        address,
        uint256
    )
        external
        view
        returns (int128 bias, int128 slope, uint256 ts, uint256 end);

    function userVestEpoch(address) external view returns (uint256);

    function userVestHistory(
        address,
        uint256
    ) external view returns (int128 amount, uint256 ts);

    function vest(address _addr, uint256 _amount) external;

    function vestWeeks() external view returns (uint256);

    function withdraw() external;
}
