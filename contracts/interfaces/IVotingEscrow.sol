// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IVotingEscrow {
    /*=== event ===*/

    event Deposit(
        address indexed provider,
        uint value,
        uint locktime,
        uint lockDuration,
        bool autoExtend,
        LockAction indexed action,
        uint ts
    );
    event Withdraw(address indexed provider, uint value, uint ts);
    event Stake(address indexed provider, uint value, uint ts);
    event Unstake(address indexed provider, uint value, uint ts);
    event Vested(address indexed account, uint value, uint ts);
    event Claimed(address indexed account, uint value, uint ts);

    /*=== struct ===*/

    struct Point {
        int128 bias;
        int128 slope;
        uint ts;
    }

    struct StakedPoint {
        int128 bias;
        int128 slope;
        uint ts;
        uint end; // timestamp to reach max veSYM
    }

    struct Vest {
        int128 amount;
        uint ts;
    }

    struct LockedBalance {
        int128 amount;
        uint end; // end of lock, used if autoExtend is false, be zero if autoExtend is true
        uint lockDuration; // duration of lock, used if autoExtend is true, be zero if autoExtend is false
        bool autoExtend;
    }

    enum LockAction {
        CREATE_LOCK,
        INCREASE_LOCK_AMOUNT,
        INCREASE_LOCK_TIME
    }

    /*=== function ===*/

    function balanceOf(address _addr) external view returns (uint);

    function balanceOfAt(address _addr, uint _timestamp) external view returns (uint);

    function baseToken() external view returns (address);

    function callbackRelayer() external view returns (address);

    function checkpoint() external;

    function claimVested() external;

    function createLock(uint _value, uint _unlockTime, uint _lockDuration, bool _autoExtend) external;

    function decimals() external view returns (uint8);

    function getLastStakedPoint(address _addr) external view returns (StakedPoint memory point);

    function globalEpoch() external view returns (uint);

    function increaseLockAmount(uint _value) external;

    function increaseLockAmountAndUnlockTime(
        uint _value,
        uint _unlockTime,
        uint _lockDuration,
        bool _autoExtend
    ) external;

    function increaseUnlockTime(uint _unlockTime, uint _lockDuration, bool _autoExtend) external;

    function locked(address) external view returns (int128 amount, uint end, uint lockDuration, bool autoExtend);

    function lockedBalanceOf(address _addr) external view returns (uint);

    function lockedBalanceOfAt(address _addr, uint _timestamp) external view returns (uint);

    function maxTime() external view returns (uint);

    function name() external view returns (string calldata);

    function pointHistory(uint) external view returns (int128 bias, int128 slope, uint ts);

    function slopeChanges(uint) external view returns (int128);

    function stake(uint _value) external;

    function staked(address) external view returns (uint);

    function stakedBalanceOf(address _addr) external view returns (uint);

    function stakedBalanceOfAt(address _addr, uint _timestamp) external view returns (uint);

    function symbol() external view returns (string calldata);

    function totalSupply() external view returns (uint);

    function totalSupplyAt(uint _timestamp) external view returns (uint);

    function unstake(uint _value) external;

    function userClaimEpoch(address) external view returns (uint);

    function userPointEpoch(address) external view returns (uint);

    function userPointHistory(address, uint) external view returns (int128 bias, int128 slope, uint ts);

    function userSlopeChanges(address, uint) external view returns (int128);

    function userStakedEpoch(address) external view returns (uint);

    function userStakedHistory(address, uint) external view returns (int128 bias, int128 slope, uint ts, uint end);

    function userVestEpoch(address) external view returns (uint);

    function userVestHistory(address, uint) external view returns (int128 amount, uint ts);

    function vest(address _addr, uint _amount) external;

    function vestWeeks() external view returns (uint);

    function withdraw() external;
}
