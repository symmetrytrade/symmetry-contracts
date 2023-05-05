// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../utils/Initializable.sol";
import "../utils/CommonContext.sol";

import "../interfaces/IVotingEscrow.sol";

import "./VotingEscrowCallback.sol";

import "hardhat/console.sol";

contract VotingEscrow is
    IVotingEscrow,
    CommonContext,
    ReentrancyGuard,
    AccessControlEnumerable,
    Initializable
{
    using SafeERC20 for IERC20;

    /*=== constants ===*/
    bytes32 public constant WHITELIST_ROLE = keccak256("WHITELIST_ROLE");
    bytes32 public constant VESTING_ROLE = keccak256("VESTING_ROLE");

    /*=== states === */
    address public baseToken;
    uint256 public maxTime;
    uint256 public vestWeeks;
    address public callbackRelayer;

    // erc20
    string public name;
    string public symbol;
    uint8 public decimals;

    // global states
    uint256 public globalEpoch;
    Point[] public pointHistory;
    mapping(uint256 => int128) public slopeChanges;
    // user locked states
    mapping(address => Point[]) public userPointHistory;
    mapping(address => uint256) public userPointEpoch;
    mapping(address => mapping(uint256 => int128)) public userSlopeChanges;
    mapping(address => LockedBalance) public locked;
    // user staked states
    mapping(address => StakedPoint[]) public userStakedHistory;
    mapping(address => uint256) public userStakedEpoch;
    mapping(address => uint256) public staked;
    // user vesting states
    mapping(address => Vest[]) public userVestHistory;
    mapping(address => uint256) public userVestEpoch;
    mapping(address => uint256) public userClaimEpoch;

    function initialize(
        address _baseToken,
        uint256 _maxTime,
        uint256 _vestWeeks,
        string memory _name,
        string memory _symbol
    ) external onlyInitializeOnce {
        baseToken = _baseToken;
        maxTime = _maxTime;
        vestWeeks = _vestWeeks;

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

    /*=== owner ===*/

    function setCallbackRelayer(address _relayer) external {
        require(
            hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "VotingEscrow: not owner"
        );
        callbackRelayer = _relayer;
    }

    /*=== getter ===*/
    /**
     * @dev Gets the last available user point
     * @param _addr User address
     * @return point last locked point
     */
    function getLastLockedPoint(
        address _addr
    ) external view returns (Point memory point) {
        uint256 uepoch = userPointEpoch[_addr];
        point = Point(0, 0, 0);
        if (uepoch == 0) {
            return point;
        }
        point = userPointHistory[_addr][uepoch];
    }

    function getLastStakedPoint(
        address _addr
    ) public view returns (StakedPoint memory point) {
        point = StakedPoint({bias: 0, slope: 0, ts: 0, end: 0});
        uint epoch = userStakedEpoch[_addr];
        if (epoch == 0) {
            return point;
        }
        point = userStakedHistory[_addr][epoch];
        point.bias = SafeCast.toInt128(
            SafeCast.toInt256(_stakedBalance(point, block.timestamp))
        );
        point.ts = block.timestamp;
    }

    function getVest(
        address _addr,
        uint256 _idx
    ) public view returns (Vest memory) {
        return userVestHistory[_addr][_idx];
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

    function _tryCallback(address _addr) internal {
        if (callbackRelayer != address(0)) {
            VotingEscrowCallback(callbackRelayer).syncWithVotingEscrow(_addr);
        }
    }

    /*=== Voting Escrow ===*/
    function _checkpoint() internal returns (Point memory lastPoint) {
        lastPoint = Point({bias: 0, slope: 0, ts: block.timestamp});
        uint256 epoch = globalEpoch;
        if (epoch > 0) {
            lastPoint = pointHistory[epoch];
        }
        // Go over weeks to fill history and calculate what the current point is
        uint256 iterativeTime = _startOfWeek(lastPoint.ts);
        for (uint256 i = 0; i < 255; i++) {
            // Hopefully it won't happen that this won't get used in 5 years!
            // If it does, users will be able to withdraw but vote weight will be broken
            iterativeTime += 1 weeks;
            int128 dSlope = 0;
            if (iterativeTime > block.timestamp) {
                iterativeTime = block.timestamp;
            } else {
                dSlope = slopeChanges[iterativeTime];
            }
            int128 biasDelta = lastPoint.slope *
                SafeCast.toInt128(int256((iterativeTime - lastPoint.ts)));
            lastPoint.bias = lastPoint.bias - biasDelta;
            lastPoint.slope = lastPoint.slope + dSlope;
            // This can happen
            if (lastPoint.bias < 0) {
                lastPoint.bias = 0;
            }
            lastPoint.ts = iterativeTime;

            if (iterativeTime == block.timestamp) {
                break;
            } else {
                epoch += 1;
                pointHistory.push(lastPoint);
            }
        }

        globalEpoch = epoch;
    }

    /**
     * @dev Record global data to checkpoint
     */
    function checkpoint() external {
        _checkpoint();
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
            iterativeTime = iterativeTime + 1 weeks;
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
     * @return Total total voting power
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
        uint256 epoch = globalEpoch;
        uint256 targetEpoch = _findPoint(_timestamp, epoch);

        Point memory point = pointHistory[targetEpoch];

        return _supplyAt(point, _timestamp);
    }

    function balanceOf(address _addr) public view returns (uint256) {
        return lockedBalanceOf(_addr) + stakedBalanceOf(_addr);
    }

    function balanceOfAt(
        address _addr,
        uint256 _timestamp
    ) public view returns (uint256) {
        return
            lockedBalanceOfAt(_addr, _timestamp) +
            stakedBalanceOfAt(_addr, _timestamp);
    }

    /*=== vesting ===*/
    function _findUserVested(
        address _addr,
        uint256 _timestamp
    ) internal view returns (uint256) {
        uint256 min = 0;
        uint256 max = userVestEpoch[_addr];
        for (uint256 i = 0; i < 128; i++) {
            if (min >= max) {
                break;
            }
            uint256 mid = (min + max + 1) / 2;
            if (userVestHistory[_addr][mid].ts <= _timestamp) {
                min = mid;
            } else {
                max = mid - 1;
            }
        }
        return min;
    }

    function vest(address _addr, uint256 _amount) external {
        require(
            hasRole(VESTING_ROLE, msg.sender),
            "VotingEscrow: not vesting role"
        );
        require(_amount > 0, "VotingEscrow: need non-zero value");

        _claimVested(msg.sender);

        uint256 uepoch = userVestEpoch[_addr];
        if (uepoch == 0) {
            userVestHistory[_addr].push(Vest(0, 0));
        }

        uint256 vestTs = _startOfWeek(block.timestamp);
        uint256 epoch = _findUserVested(_addr, vestTs + 1 weeks);
        uint256 len = vestWeeks;
        int128 vestAmount = SafeCast.toInt128(SafeCast.toInt256(_amount / len));
        if (vestAmount == 0) {
            return;
        }
        LockedBalance[] memory oldLocks = new LockedBalance[](len);
        LockedBalance[] memory newLocks = new LockedBalance[](len);
        for (uint i = 0; i < len; ++i) {
            vestTs += 1 weeks;
            LockedBalance memory oldLocked = LockedBalance(0, vestTs, 0, false);
            LockedBalance memory newLocked = LockedBalance(0, vestTs, 0, false);
            if (epoch > uepoch || userVestHistory[_addr][epoch].ts < vestTs) {
                userVestHistory[_addr].push(Vest(vestAmount, vestTs));
                newLocked.amount = vestAmount;
                ++uepoch;
            } else {
                oldLocked.amount = userVestHistory[_addr][epoch].amount;
                newLocked.amount = oldLocked.amount + vestAmount;
                userVestHistory[_addr][epoch].amount = newLocked.amount;
            }
            ++epoch;
            oldLocks[i] = oldLocked;
            newLocks[i] = newLocked;
        }
        userVestEpoch[_addr] = uepoch;

        _checkpointLocked(_addr, oldLocks, newLocks);

        // callback here is unnecessary and may lead to reentrancy
        emit Vested(_addr, _amount, block.timestamp);
    }

    function claimVested() external {
        _claimVested(msg.sender);
    }

    function _claimVested(address _addr) internal {
        uint256 vestedEpoch = userVestEpoch[_addr];
        uint256 claimEpoch = userClaimEpoch[_addr];

        if (claimEpoch == 0) {
            claimEpoch = 1;
        }
        int128 toClaim = 0;

        // at most $vestWeeks$ iterations
        while (claimEpoch <= vestedEpoch) {
            if (userVestHistory[_addr][claimEpoch].ts > block.timestamp) {
                break;
            }
            toClaim += userVestHistory[_addr][claimEpoch].amount;
            ++claimEpoch;
        }
        if (toClaim > 0) {
            userClaimEpoch[_addr] = claimEpoch;
            IERC20(baseToken).safeTransfer(_addr, SafeCast.toUint256(toClaim));

            emit Claimed(_addr, SafeCast.toUint256(toClaim), block.timestamp);
        }
    }

    /*=== stake ===*/
    function _checkpointStaked(
        address _addr,
        StakedPoint memory _oldStaked,
        StakedPoint memory _newStaked
    ) internal {
        int128 oldSlope = block.timestamp >= _oldStaked.end
            ? int128(0)
            : _oldStaked.slope;
        int128 newSlope = block.timestamp >= _newStaked.end
            ? int128(0)
            : _newStaked.slope;
        int128 oldSlopeDelta = slopeChanges[_oldStaked.end];
        int128 newSlopeDelta = slopeChanges[_newStaked.end];

        Point memory lastPoint = _checkpoint();

        if (_addr != address(0)) {
            lastPoint.slope = lastPoint.slope + newSlope - oldSlope;
            lastPoint.bias = lastPoint.bias + _newStaked.bias - _oldStaked.bias;
            if (lastPoint.bias < 0) {
                lastPoint.bias = 0;
            }
        }

        globalEpoch += 1;
        pointHistory.push(lastPoint);

        if (_addr != address(0)) {
            if (_oldStaked.end > block.timestamp) {
                oldSlopeDelta = oldSlopeDelta + oldSlope;
                if (_newStaked.end == _oldStaked.end) {
                    oldSlopeDelta = oldSlopeDelta - newSlope;
                }
                slopeChanges[_oldStaked.end] = oldSlopeDelta;
            }
            if (_newStaked.end > block.timestamp) {
                if (_newStaked.end != _oldStaked.end) {
                    newSlopeDelta = newSlopeDelta - newSlope;
                    slopeChanges[_newStaked.end] = newSlopeDelta;
                }
            }

            uint256 uEpoch = userStakedEpoch[_addr];
            if (uEpoch == 0) {
                userStakedHistory[_addr].push(_oldStaked);
            }
            userStakedEpoch[_addr] = uEpoch + 1;
            userStakedHistory[_addr].push(_newStaked);
        }
    }

    function _findUserStaked(
        address _addr,
        uint256 _timestamp
    ) internal view returns (uint256) {
        uint256 min = 0;
        uint256 max = userStakedEpoch[_addr];
        for (uint256 i = 0; i < 128; i++) {
            if (min >= max) {
                break;
            }
            uint256 mid = (min + max + 1) / 2;
            if (userStakedHistory[_addr][mid].ts <= _timestamp) {
                min = mid;
            } else {
                max = mid - 1;
            }
        }
        return min;
    }

    function _stakedBalance(
        StakedPoint memory _point,
        uint256 _ts
    ) internal pure returns (uint256) {
        // since end time is rounded down to week, so this is possible
        if (_point.ts >= _point.end) {
            return SafeCast.toUint256(_point.bias);
        }
        int interval = SafeCast.toInt128(
            int256(_ts > _point.end ? _point.end - _point.ts : _ts - _point.ts)
        );
        // slope is non-positive, bias >= 0
        return SafeCast.toUint256(_point.bias - (_point.slope * interval));
    }

    function stakedBalanceOf(address _addr) public view returns (uint256) {
        uint epoch = userStakedEpoch[_addr];
        if (epoch == 0) {
            return 0;
        }
        StakedPoint memory lastPoint = userStakedHistory[_addr][epoch];
        return _stakedBalance(lastPoint, block.timestamp);
    }

    function stakedBalanceOfAt(
        address _addr,
        uint256 _timestamp
    ) public view returns (uint256) {
        // Get most recent user staked point
        uint256 userEpoch = _findUserStaked(_addr, _timestamp);
        if (userEpoch == 0) {
            return 0;
        }
        StakedPoint memory upoint = userStakedHistory[_addr][userEpoch];
        return _stakedBalance(upoint, _timestamp);
    }

    function stake(uint256 _value) external nonReentrant {
        _assertNotContract();

        _claimVested(msg.sender);

        require(_value > 0, "VotingEscrow: need non-zero value");
        IERC20(baseToken).safeTransferFrom(msg.sender, address(this), _value);
        uint256 stakedValue = staked[msg.sender] + _value;
        staked[msg.sender] = stakedValue;

        StakedPoint memory oldStaked = getLastStakedPoint(msg.sender);
        StakedPoint memory newStaked = StakedPoint({
            bias: oldStaked.bias,
            slope: -SafeCast.toInt128(SafeCast.toInt256(stakedValue / maxTime)),
            ts: block.timestamp,
            end: _startOfWeek(
                block.timestamp +
                    ((stakedValue - SafeCast.toUint256(oldStaked.bias)) *
                        maxTime) /
                    stakedValue
            )
        });
        _checkpointStaked(msg.sender, oldStaked, newStaked);

        _tryCallback(msg.sender);
        emit Stake(msg.sender, _value, block.timestamp);
    }

    function unstake(uint256 _value) external nonReentrant {
        _claimVested(msg.sender);

        uint256 stakedValue = staked[msg.sender];
        require(stakedValue > _value, "VotingEscrow: insufficient staked");
        stakedValue -= _value;
        staked[msg.sender] = stakedValue;

        StakedPoint memory oldStaked = getLastStakedPoint(msg.sender);
        StakedPoint memory newStaked = StakedPoint({
            bias: 0,
            slope: -SafeCast.toInt128(SafeCast.toInt256(stakedValue / maxTime)),
            ts: block.timestamp,
            end: _startOfWeek(block.timestamp + maxTime)
        });
        _checkpointStaked(msg.sender, oldStaked, newStaked);

        IERC20(baseToken).transfer(msg.sender, _value);

        _tryCallback(msg.sender);
        emit Unstake(msg.sender, _value, block.timestamp);
    }

    /*=== lock ===*/
    function _userLockedPoint(
        address _addr,
        Point memory _point,
        uint256 _t
    ) internal view returns (Point memory lastPoint) {
        // _point is the latest point user made operation on veSYM before _t.
        // Hence, there can be at most $vestWeeks$ slope changes between this point and _t,
        // and these slope changes must happen in consecutive weeks following _point.
        // Therefore, we only need to iterate $vestWeeks$ weeks here.
        lastPoint = _point;
        uint256 iterativeTime = _startOfWeek(lastPoint.ts);
        uint256 len = vestWeeks;
        for (uint256 i = 0; i < len; ++i) {
            iterativeTime = iterativeTime + 1 weeks;
            int128 dSlope = 0;
            if (iterativeTime > _t) {
                iterativeTime = _t;
            } else {
                dSlope = userSlopeChanges[_addr][iterativeTime];
            }

            lastPoint.bias =
                lastPoint.bias -
                (lastPoint.slope *
                    SafeCast.toInt128(int256(iterativeTime - lastPoint.ts)));
            lastPoint.slope = lastPoint.slope + dSlope;
            lastPoint.ts = iterativeTime;
            if (iterativeTime == _t) {
                break;
            }
        }
        // in the rest time period, there is at most one active lock by user
        lastPoint.bias =
            lastPoint.bias -
            (lastPoint.slope * SafeCast.toInt128(int256(_t - lastPoint.ts)));
        if (lastPoint.bias < 0) {
            lastPoint.bias = 0;
        }
        lastPoint.ts = _t;
    }

    function _userCheckpoint(
        address _addr
    ) internal view returns (Point memory lastPoint) {
        lastPoint = Point({bias: 0, slope: 0, ts: block.timestamp});
        uint256 epoch = userPointEpoch[_addr];
        if (epoch > 0) {
            lastPoint = userPointHistory[_addr][epoch];
        }
        return _userLockedPoint(_addr, lastPoint, block.timestamp);
    }

    function _updateSlopeChanges(
        address _addr,
        LockedBalance memory _oldLocked,
        LockedBalance memory _newLocked
    ) internal returns (Point memory userOldPoint, Point memory userNewPoint) {
        int128 oldSlopeDelta = 0;
        int128 oldUserSlopeDelta = 0;
        int128 newSlopeDelta = 0;
        int128 newUserSlopeDelta = 0;

        // Calculate slopes and biases
        // Kept at zero when they have to
        if (_oldLocked.autoExtend) {
            // userOldPoint.slope = 0;
            userOldPoint.bias =
                (_oldLocked.amount / SafeCast.toInt128(int256(maxTime))) *
                SafeCast.toInt128(int256(_oldLocked.lockDuration));
        } else {
            oldSlopeDelta = slopeChanges[_oldLocked.end];
            oldUserSlopeDelta = userSlopeChanges[_addr][_oldLocked.end];
            if (_oldLocked.end > block.timestamp && _oldLocked.amount > 0) {
                userOldPoint.slope =
                    _oldLocked.amount /
                    SafeCast.toInt128(int256(maxTime));
                userOldPoint.bias =
                    userOldPoint.slope *
                    SafeCast.toInt128(int256(_oldLocked.end - block.timestamp));
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
                    newUserSlopeDelta = oldUserSlopeDelta;
                } else {
                    newSlopeDelta = slopeChanges[_newLocked.end];
                    newUserSlopeDelta = userSlopeChanges[_addr][_newLocked.end];
                }
            }
            if (_newLocked.end > block.timestamp && _newLocked.amount > 0) {
                userNewPoint.slope =
                    _newLocked.amount /
                    SafeCast.toInt128(int256(maxTime));
                userNewPoint.bias =
                    userNewPoint.slope *
                    SafeCast.toInt128(int256(_newLocked.end - block.timestamp));
            }
        }

        // Schedule the slope changes (slope is going down)
        // We subtract new_user_slope from [new_locked.end]
        // and add old_user_slope to [old_locked.end]
        if (_oldLocked.end > block.timestamp) {
            // oldSlopeDelta was <something> - userOldPoint.slope, so we cancel that
            oldSlopeDelta = oldSlopeDelta + userOldPoint.slope;
            oldUserSlopeDelta = oldUserSlopeDelta + userOldPoint.slope;
            if (_newLocked.end == _oldLocked.end) {
                oldSlopeDelta = oldSlopeDelta - userNewPoint.slope; // It was a new deposit, not extension
                oldUserSlopeDelta = oldUserSlopeDelta - userNewPoint.slope; // It was a new deposit, not extension
            }
            slopeChanges[_oldLocked.end] = oldSlopeDelta;
            userSlopeChanges[_addr][_oldLocked.end] = oldUserSlopeDelta;
        }
        if (_newLocked.end > block.timestamp) {
            if (_newLocked.end > _oldLocked.end) {
                newSlopeDelta = newSlopeDelta - userNewPoint.slope; // old slope disappeared at this point
                newUserSlopeDelta = newUserSlopeDelta - userNewPoint.slope; // old slope disappeared at this point
                slopeChanges[_newLocked.end] = newSlopeDelta;
                userSlopeChanges[_addr][_newLocked.end] = newSlopeDelta;
            }
            // else: we recorded it already in oldSlopeDelta
        }
    }

    /**
     * @dev Record global and per-user data to checkpoint on a new lock operation
     * @param _addr User's wallet address. No user checkpoint if 0x0
     * @param _oldLocked Pevious locked amount / end lock time for the user
     * @param _newLocked New locked amount / end lock time for the user
     */
    function _checkpointLocked(
        address _addr,
        LockedBalance[] memory _oldLocked,
        LockedBalance[] memory _newLocked
    ) internal {
        Point memory userOldPoint;
        Point memory userNewPoint;
        uint len = _oldLocked.length;
        for (uint i = 0; i < len; ++i) {
            (
                Point memory oldPoint,
                Point memory newPoint
            ) = _updateSlopeChanges(_addr, _oldLocked[i], _newLocked[i]);
            userOldPoint.slope += oldPoint.slope;
            userOldPoint.bias += oldPoint.bias;
            userNewPoint.slope += newPoint.slope;
            userNewPoint.bias += newPoint.bias;
        }

        Point memory lastPoint = _checkpoint();
        // Now pointHistory is filled until t=now

        // If last point was in this block, the slope change has been applied already
        // But in such case we have 0 slope(s)
        lastPoint.slope =
            lastPoint.slope +
            userNewPoint.slope -
            userOldPoint.slope;
        lastPoint.bias = lastPoint.bias + userNewPoint.bias - userOldPoint.bias;
        if (lastPoint.bias < 0) {
            lastPoint.bias = 0;
        }

        // Record the changed point into history
        // pointHistory[epoch] = lastPoint;
        globalEpoch += 1;
        pointHistory.push(lastPoint);

        uint256 uEpoch = userPointEpoch[_addr];
        if (uEpoch == 0) {
            userPointHistory[_addr].push(userOldPoint);
        }
        // compute current user point
        Point memory userPoint = _userCheckpoint(_addr);
        userPoint.slope =
            userPoint.slope +
            userNewPoint.slope -
            userOldPoint.slope;
        userPoint.bias = userPoint.bias + userNewPoint.bias - userOldPoint.bias;
        userPointEpoch[_addr] = uEpoch + 1;
        userPointHistory[_addr].push(userPoint);
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
        LockedBalance[] memory oldLocks = new LockedBalance[](1);
        LockedBalance[] memory newLocks = new LockedBalance[](1);
        oldLocks[0] = _oldLocked;
        newLocks[0] = _newLocked;
        _checkpointLocked(_addr, oldLocks, newLocks);

        uint256 value = SafeCast.toUint256(
            _newLocked.amount - _oldLocked.amount
        );
        if (value != 0) {
            IERC20(baseToken).safeTransferFrom(_addr, address(this), value);
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

        _claimVested(msg.sender);
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

        _tryCallback(msg.sender);
    }

    /**
     * @dev Deposit `_value` additional tokens for `msg.sender` without modifying the unlock time
     * @param _value Amount of tokens to deposit and add to the lock
     */
    function increaseLockAmount(uint256 _value) external nonReentrant {
        _claimVested(msg.sender);

        _increaseLockAmount(_value);

        _tryCallback(msg.sender);
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
        _claimVested(msg.sender);

        _increaseUnlockTime(_unlockTime, _lockDuration, _autoExtend);

        _tryCallback(msg.sender);
    }

    function increaseLockAmountAndUnlockTime(
        uint256 _value,
        uint256 _unlockTime,
        uint256 _lockDuration,
        bool _autoExtend
    ) external nonReentrant {
        _claimVested(msg.sender);

        _increaseLockAmount(_value);
        _increaseUnlockTime(_unlockTime, _lockDuration, _autoExtend);

        _tryCallback(msg.sender);
    }

    function _increaseLockAmount(uint256 _value) internal {
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

    function _increaseUnlockTime(
        uint256 _unlockTime,
        uint256 _lockDuration,
        bool _autoExtend
    ) internal {
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
        _claimVested(msg.sender);

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

        IERC20(baseToken).safeTransfer(_addr, value);

        emit Withdraw(_addr, value, block.timestamp);
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

    function _lockedBalance(
        address _addr,
        Point memory _point,
        uint256 _t
    ) internal view returns (uint256) {
        return SafeCast.toUint256(_userLockedPoint(_addr, _point, _t).bias);
    }

    /**
     * @dev Get the current voting power for `msg.sender`
     * @param _addr User wallet address
     * @return uint256 voting power of user
     */
    function lockedBalanceOf(address _addr) public view returns (uint256) {
        uint256 epoch = userPointEpoch[_addr];
        if (epoch == 0) {
            return 0;
        }
        Point memory lastPoint = userPointHistory[_addr][epoch];
        return _lockedBalance(_addr, lastPoint, block.timestamp);
    }

    /**
     * @dev Get the voting power for `msg.sender` at specific time
     * @param _addr User wallet address
     * @param _timestamp Time to query
     * @return uint256 voting power of user
     */
    function lockedBalanceOfAt(
        address _addr,
        uint256 _timestamp
    ) public view returns (uint256) {
        // Get most recent user Point
        uint256 userEpoch = _findUserPoint(_addr, _timestamp);
        if (userEpoch == 0) {
            return 0;
        }
        Point memory upoint = userPointHistory[_addr][userEpoch];
        return _lockedBalance(_addr, upoint, _timestamp);
    }
}
