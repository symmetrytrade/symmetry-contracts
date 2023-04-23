// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../utils/Initializable.sol";

contract VotingEscrow is
    ReentrancyGuard,
    AccessControlEnumerable,
    Initializable
{
    using SafeERC20 for IERC20;

    /*=== events ===*/
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

    /*=== constants ===*/
    uint256 private constant WEEK = 7 days;
    bytes32 public constant WHITELIST_ROLE = keccak256("WHITELIST_ROLE");

    /*=== states === */
    IERC20 public baseToken;
    uint256 public maxTime;

    // erc20
    string public name;
    string public symbol;
    uint8 public decimals;

    // global states
    uint256 public globalEpoch;
    Point[] public pointHistory;
    mapping(uint256 => int128) public slopeChanges;
    // user states
    mapping(address => Point[]) public userPointHistory;
    mapping(address => uint256) public userPointEpoch;
    mapping(address => LockedBalance) public locked;

    /*=== structs ===*/
    struct Point {
        int128 bias;
        int128 slope;
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

    function initialize(
        address _baseToken,
        uint256 _maxTime,
        string memory _name,
        string memory _symbol
    ) external onlyInitializeOnce {
        baseToken = IERC20(_baseToken);
        maxTime = _maxTime;

        Point memory init = Point({
            bias: int128(0),
            slope: int128(0),
            ts: block.timestamp
        });
        pointHistory.push(init);

        decimals = IERC20Metadata(_baseToken).decimals();
        require(
            decimals <= 18,
            "VotingEscrow: Cannot have more than 18 decimals"
        );

        name = _name;
        symbol = _symbol;

        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /*=== getter ===*/
    /**
     * @dev Gets the last available user point
     * @param _addr User address
     * @return bias Value of bias
     * @return slope Value of slope
     * @return ts Epoch time of the checkpoint
     */
    function getLastUserPoint(
        address _addr
    ) external view returns (int128 bias, int128 slope, uint256 ts) {
        uint256 uepoch = userPointEpoch[_addr];
        if (uepoch == 0) {
            return (0, 0, 0);
        }
        Point memory point = userPointHistory[_addr][uepoch];
        return (point.bias, point.slope, point.ts);
    }

    /*=== Voting Escrow ===*/
    /**
     * @dev Record global and per-user data to checkpoint
     * @param _addr User's wallet address. No user checkpoint if 0x0
     * @param _oldLocked Pevious locked amount / end lock time for the user
     * @param _newLocked New locked amount / end lock time for the user
     */
    function _checkpoint(
        address _addr,
        LockedBalance memory _oldLocked,
        LockedBalance memory _newLocked
    ) internal {
        Point memory userOldPoint;
        Point memory userNewPoint;
        int128 oldSlopeDelta = 0;
        int128 newSlopeDelta = 0;
        uint256 epoch = globalEpoch;

        if (_addr != address(0)) {
            // Calculate slopes and biases
            // Kept at zero when they have to
            if (_oldLocked.autoExtend) {
                // userOldPoint.slope = 0;
                userOldPoint.bias =
                    (_oldLocked.amount / SafeCast.toInt128(int256(maxTime))) *
                    SafeCast.toInt128(int256(_oldLocked.lockDuration));
            } else {
                oldSlopeDelta = slopeChanges[_oldLocked.end];
                if (_oldLocked.end > block.timestamp && _oldLocked.amount > 0) {
                    userOldPoint.slope =
                        _oldLocked.amount /
                        SafeCast.toInt128(int256(maxTime));
                    userOldPoint.bias =
                        userOldPoint.slope *
                        SafeCast.toInt128(
                            int256(_oldLocked.end - block.timestamp)
                        );
                }
            }
            if (_newLocked.autoExtend) {
                // userNewPoint.slope = 0;
                userNewPoint.bias =
                    (_newLocked.amount / SafeCast.toInt128(int256(maxTime))) *
                    SafeCast.toInt128(int256(_newLocked.lockDuration));
            } else {
                if (_newLocked.end != 0) {
                    if (_newLocked.end == _oldLocked.end) {
                        newSlopeDelta = oldSlopeDelta;
                    } else {
                        newSlopeDelta = slopeChanges[_newLocked.end];
                    }
                }
                if (_newLocked.end > block.timestamp && _newLocked.amount > 0) {
                    userNewPoint.slope =
                        _newLocked.amount /
                        SafeCast.toInt128(int256(maxTime));
                    userNewPoint.bias =
                        userNewPoint.slope *
                        SafeCast.toInt128(
                            int256(_newLocked.end - block.timestamp)
                        );
                }
            }
        }

        Point memory lastPoint = Point({
            bias: 0,
            slope: 0,
            ts: block.timestamp
        });
        if (epoch > 0) {
            lastPoint = pointHistory[epoch];
        }
        uint256 lastCheckpoint = lastPoint.ts;

        // Go over weeks to fill history and calculate what the current point is
        uint256 iterativeTime = _startOfWeek(lastCheckpoint);
        for (uint256 i = 0; i < 255; i++) {
            // Hopefully it won't happen that this won't get used in 5 years!
            // If it does, users will be able to withdraw but vote weight will be broken
            iterativeTime += WEEK;
            int128 dSlope = 0;
            if (iterativeTime > block.timestamp) {
                iterativeTime = block.timestamp;
            } else {
                dSlope = slopeChanges[iterativeTime];
            }
            int128 biasDelta = lastPoint.slope *
                SafeCast.toInt128(int256((iterativeTime - lastCheckpoint)));
            lastPoint.bias = lastPoint.bias - biasDelta;
            lastPoint.slope = lastPoint.slope + dSlope;
            // This can happen
            if (lastPoint.bias < 0) {
                lastPoint.bias = 0;
            }
            // This cannot happen - just in case
            if (lastPoint.slope < 0) {
                lastPoint.slope = 0;
            }
            lastCheckpoint = iterativeTime;
            lastPoint.ts = iterativeTime;

            // when epoch is incremented, we either push here or after slopes updated below
            epoch += 1;
            if (iterativeTime == block.timestamp) {
                break;
            } else {
                pointHistory.push(lastPoint);
            }
        }

        globalEpoch = epoch;
        // Now pointHistory is filled until t=now

        if (_addr != address(0)) {
            // If last point was in this block, the slope change has been applied already
            // But in such case we have 0 slope(s)
            lastPoint.slope =
                lastPoint.slope +
                userNewPoint.slope -
                userOldPoint.slope;
            lastPoint.bias =
                lastPoint.bias +
                userNewPoint.bias -
                userOldPoint.bias;
            if (lastPoint.slope < 0) {
                lastPoint.slope = 0;
            }
            if (lastPoint.bias < 0) {
                lastPoint.bias = 0;
            }
        }

        // Record the changed point into history
        // pointHistory[epoch] = lastPoint;
        pointHistory.push(lastPoint);

        if (_addr != address(0)) {
            // Schedule the slope changes (slope is going down)
            // We subtract new_user_slope from [new_locked.end]
            // and add old_user_slope to [old_locked.end]
            if (_oldLocked.end > block.timestamp) {
                // oldSlopeDelta was <something> - userOldPoint.slope, so we cancel that
                oldSlopeDelta = oldSlopeDelta + userOldPoint.slope;
                if (_newLocked.end == _oldLocked.end) {
                    oldSlopeDelta = oldSlopeDelta - userNewPoint.slope; // It was a new deposit, not extension
                }
                slopeChanges[_oldLocked.end] = oldSlopeDelta;
            }
            if (_newLocked.end > block.timestamp) {
                if (_newLocked.end > _oldLocked.end) {
                    newSlopeDelta = newSlopeDelta - userNewPoint.slope; // old slope disappeared at this point
                    slopeChanges[_newLocked.end] = newSlopeDelta;
                }
                // else: we recorded it already in oldSlopeDelta
            }

            uint256 uEpoch = userPointEpoch[_addr];
            if (uEpoch == 0) {
                userPointHistory[_addr].push(userOldPoint);
            }
            userPointEpoch[_addr] = uEpoch + 1;
            userNewPoint.ts = block.timestamp;
            userPointHistory[_addr].push(userNewPoint);
        }
    }

    /**
     * @dev Deposit and lock tokens for a user
     * @param _addr User's wallet address
     * @param _oldLocked Previous locked information
     * @param _newLocked New locked information
     * @param _action LockAction type
     */
    function _depositFor(
        address _addr,
        LockedBalance memory _oldLocked,
        LockedBalance memory _newLocked,
        LockAction _action
    ) internal {
        locked[_addr] = _newLocked;

        // Possibilities:
        // Both _oldLocked.end could be current or expired (>/< block.timestamp)
        // value == 0 (extend lock) or value > 0 (add to lock or extend lock)
        // newLocked.end > block.timestamp (always)
        _checkpoint(_addr, _oldLocked, _newLocked);

        uint256 value = SafeCast.toUint256(
            _newLocked.amount - _oldLocked.amount
        );
        if (value != 0) {
            baseToken.safeTransferFrom(_addr, address(this), value);
        }
        emit Deposit(
            _addr,
            value,
            _newLocked.end,
            _newLocked.lockDuration,
            _newLocked.autoExtend,
            _action,
            block.timestamp
        );
    }

    /**
     * @dev Record global data to checkpoint
     */
    function checkpoint() external {
        LockedBalance memory empty;
        _checkpoint(address(0), empty, empty);
    }

    /**
     * @dev Deposit `_value` tokens for `msg.sender` and lock until `_unlockTime`,
     *      or lock for `_lockDuration` if autoExtend is true
     * @param _value Amount to deposit
     * @param _unlockTime Time when tokens unlock
     * @param _lockDuration Time length of tokens to lock
     * @param _autoExtend If the lock will be auto extended
     */
    function createLock(
        uint256 _value,
        uint256 _unlockTime,
        uint256 _lockDuration,
        bool _autoExtend
    ) external nonReentrant {
        _assertNotContract();

        _unlockTime = _startOfWeek(_unlockTime); // Locktime is rounded down to weeks
        LockedBalance memory oldLocked = locked[msg.sender];
        LockedBalance memory newLocked = LockedBalance({
            amount: SafeCast.toInt128(SafeCast.toInt256(_value)),
            end: _autoExtend ? 0 : _unlockTime,
            lockDuration: _autoExtend ? _lockDuration : 0,
            autoExtend: _autoExtend
        });

        require(_value > 0, "VotingEscrow: need non-zero value");
        require(
            oldLocked.amount == 0,
            "VotingEscrow: Withdraw old tokens first"
        );

        if (_autoExtend) {
            require(
                _lockDuration > 0,
                "VotingEscrow: need non-zero lock duration"
            );
        } else {
            require(
                _unlockTime > block.timestamp,
                "VotingEscrow: Can only lock until time in the future"
            );
            require(
                _unlockTime <= block.timestamp + maxTime,
                "VotingEscrow: Voting lock exceeds max time"
            );
        }

        _depositFor(msg.sender, oldLocked, newLocked, LockAction.CREATE_LOCK);
    }

    /**
     * @dev Deposit `_value` additional tokens for `msg.sender` without modifying the unlock time
     * @param _value Amount of tokens to deposit and add to the lock
     */
    function increaseLockAmount(uint256 _value) external nonReentrant {
        _assertNotContract();

        LockedBalance memory oldLocked = locked[msg.sender];
        LockedBalance memory newLocked = LockedBalance({
            amount: oldLocked.amount +
                SafeCast.toInt128(SafeCast.toInt256(_value)),
            end: oldLocked.end,
            lockDuration: oldLocked.lockDuration,
            autoExtend: oldLocked.autoExtend
        });

        require(_value > 0, "VotingEscrow: need non-zero value");
        require(oldLocked.amount > 0, "VotingEscrow: No existing lock found");
        if (!oldLocked.autoExtend) {
            require(
                oldLocked.end > block.timestamp,
                "VotingEscrow: Cannot add to expired lock. Withdraw"
            );
        }

        _depositFor(
            msg.sender,
            oldLocked,
            newLocked,
            LockAction.INCREASE_LOCK_AMOUNT
        );
    }

    /**
     * @dev Extend the unlock time for `msg.sender` to `_unlockTime`, or make the lock
     *      auto extended and set a longer lock duartion
     * @param _unlockTime New epoch time for unlocking
     * @param _lockDuration Time length of tokens to lock
     * @param _autoExtend If the lock will be auto extended
     */
    function increaseUnlockTime(
        uint256 _unlockTime,
        uint256 _lockDuration,
        bool _autoExtend
    ) external nonReentrant {
        _assertNotContract();

        _unlockTime = _startOfWeek(_unlockTime); // Locktime is rounded down to weeks
        LockedBalance memory oldLocked = locked[msg.sender];
        LockedBalance memory newLocked = LockedBalance({
            amount: oldLocked.amount,
            end: _autoExtend ? 0 : _unlockTime,
            lockDuration: _autoExtend ? _lockDuration : 0,
            autoExtend: _autoExtend
        });

        if (!oldLocked.autoExtend) {
            require(
                oldLocked.end > block.timestamp,
                "VotingEscrow: Lock expired"
            );
            if (
                (!newLocked.autoExtend && newLocked.end <= oldLocked.end) ||
                (newLocked.autoExtend &&
                    newLocked.lockDuration < oldLocked.end - block.timestamp)
            ) {
                revert("VotingEscrow: Can only increase unlock time");
            }
        } else if (
            (!newLocked.autoExtend &&
                newLocked.end < oldLocked.lockDuration + block.timestamp) ||
            (newLocked.autoExtend &&
                newLocked.lockDuration <= oldLocked.lockDuration)
        ) {
            revert("VotingEscrow: Can only increase unlock time");
        }
        require(oldLocked.amount > 0, "VotingEscrow: Nothing is locked");
        require(
            (!newLocked.autoExtend &&
                newLocked.end <= block.timestamp + maxTime) ||
                (newLocked.autoExtend && newLocked.lockDuration <= maxTime),
            "VotingEscrow: Voting lock exceeds max time"
        );

        _depositFor(
            msg.sender,
            oldLocked,
            newLocked,
            LockAction.INCREASE_LOCK_TIME
        );
    }

    /**
     * @dev Withdraw all tokens for `msg.sender`, only possible if the lock has expired
     */
    function withdraw() external {
        _withdraw(msg.sender);
    }

    function _withdraw(address _addr) internal nonReentrant {
        LockedBalance memory oldLock = locked[_addr];
        require(!oldLock.autoExtend, "VotingEscrow: lock is auto extended");
        require(
            block.timestamp >= oldLock.end,
            "VotingEscrow: The lock didn't expire"
        );

        uint256 value = SafeCast.toUint256(oldLock.amount);

        LockedBalance memory empty;
        locked[_addr] = empty;

        // checkpoint is not necessary here

        baseToken.safeTransfer(_addr, value);

        emit Withdraw(_addr, value, block.timestamp);
    }

    /*===  helper functions ===*/

    /* solhint-disable avoid-tx-origin */
    function _assertNotContract() private view {
        if (msg.sender != tx.origin) {
            require(
                hasRole(WHITELIST_ROLE, msg.sender),
                "VotingEscrow: Smart contract depositors not allowed"
            );
        }
    }

    /* solhint-enable avoid-tx-origin */

    function _startOfWeek(uint256 _t) internal pure returns (uint256) {
        return (_t / WEEK) * WEEK;
    }

    /**
     * @dev Uses binarysearch to find the most recent point history whose timestamp <= given timestamp
     * @param _timestamp Find the most recent point history before this timestamp
     * @param _maxEpoch Do not search pointHistories past this index
     */
    function _findPoint(
        uint256 _timestamp,
        uint256 _maxEpoch
    ) internal view returns (uint256) {
        // Binary search
        uint256 min = 0;
        uint256 max = _maxEpoch;
        // Will be always enough for 128-bit numbers
        for (uint256 i = 0; i < 128; i++) {
            if (min >= max) break;
            uint256 mid = (min + max + 1) / 2;
            if (pointHistory[mid].ts <= _timestamp) {
                min = mid;
            } else {
                max = mid - 1;
            }
        }
        return min;
    }

    /**
     * @dev Uses binarysearch to find the most recent point history whose timestamp <= given timestamp
     * @param _addr user address
     * @param _timestamp Find the most recent point history before this timestamp
     */
    function _findUserPoint(
        address _addr,
        uint256 _timestamp
    ) internal view returns (uint256) {
        uint256 min = 0;
        uint256 max = userPointEpoch[_addr];
        for (uint256 i = 0; i < 128; i++) {
            if (min >= max) {
                break;
            }
            uint256 mid = (min + max + 1) / 2;
            if (userPointHistory[_addr][mid].ts <= _timestamp) {
                min = mid;
            } else {
                max = mid - 1;
            }
        }
        return min;
    }

    /**
     * @dev Get the current voting power for `msg.sender`
     * @param _addr User wallet address
     * @return uint256 voting power of user
     */
    function balanceOf(address _addr) public view returns (uint256) {
        uint256 epoch = userPointEpoch[_addr];
        if (epoch == 0) {
            return 0;
        }
        Point memory lastPoint = userPointHistory[_addr][epoch];
        lastPoint.bias =
            lastPoint.bias -
            (lastPoint.slope *
                SafeCast.toInt128(int256(block.timestamp - lastPoint.ts)));
        if (lastPoint.bias < 0) {
            lastPoint.bias = 0;
        }
        return SafeCast.toUint256(lastPoint.bias);
    }

    /**
     * @dev Get the voting power for `msg.sender` at specific time
     * @param _addr User wallet address
     * @param _timestamp Time to query
     * @return uint256 voting power of user
     */
    function balanceOfAt(
        address _addr,
        uint256 _timestamp
    ) public view returns (uint256) {
        // Get most recent user Point
        uint256 userEpoch = _findUserPoint(_addr, _timestamp);
        if (userEpoch == 0) {
            return 0;
        }
        Point memory upoint = userPointHistory[_addr][userEpoch];

        upoint.bias =
            upoint.bias -
            (upoint.slope * SafeCast.toInt128(int256(_timestamp - upoint.ts)));
        if (upoint.bias >= 0) {
            return SafeCast.toUint256(upoint.bias);
        } else {
            return 0;
        }
    }

    /**
     * @dev Calculate total voting power at a timestamp in the past
     * @param _point Most recent point before time _t
     * @param _t Time at which to calculate supply
     * @return totalSupply at given point in time
     */
    function _supplyAt(
        Point memory _point,
        uint256 _t
    ) internal view returns (uint256) {
        Point memory lastPoint = _point;
        // Floor the timestamp to weekly interval
        uint256 iterativeTime = _startOfWeek(lastPoint.ts);
        // Iterate through all weeks between _point & _t to account for slope changes
        for (uint256 i = 0; i < 255; i++) {
            iterativeTime = iterativeTime + WEEK;
            int128 dSlope = 0;
            if (iterativeTime > _t) {
                iterativeTime = _t;
            } else {
                dSlope = slopeChanges[iterativeTime];
            }

            lastPoint.bias =
                lastPoint.bias -
                (lastPoint.slope *
                    SafeCast.toInt128(int256(iterativeTime - lastPoint.ts)));
            if (iterativeTime == _t) {
                break;
            }
            lastPoint.slope = lastPoint.slope + dSlope;
            lastPoint.ts = iterativeTime;
        }

        if (lastPoint.bias < 0) {
            lastPoint.bias = 0;
        }
        return SafeCast.toUint256(lastPoint.bias);
    }

    /**
     * @dev Calculate total voting power
     * @return totalSTotal voting power
     */
    function totalSupply() public view returns (uint256) {
        uint256 epoch_ = globalEpoch;
        Point memory lastPoint = pointHistory[epoch_];
        return _supplyAt(lastPoint, block.timestamp);
    }

    /**
     * @dev Calculate total voting power at a timestamp in the past
     * @param _timestamp Time at which to calculate supply
     * @return Total voting power at `_timestamp`
     */
    function totalSupplyAt(uint256 _timestamp) public view returns (uint256) {
        require(block.timestamp >= _timestamp, "VotingEscrow: not past time");
        uint256 epoch = globalEpoch;
        uint256 targetEpoch = _findPoint(_timestamp, epoch);

        Point memory point = pointHistory[targetEpoch];

        return _supplyAt(point, _timestamp);
    }
}
