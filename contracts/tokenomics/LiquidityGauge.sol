// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "../interfaces/IVotingEscrow.sol";
import "../interfaces/ISYM.sol";
import "../interfaces/ISYMRate.sol";

import "./VotingEscrowCallback.sol";

import "../utils/Initializable.sol";

contract LiquidityGauge is Initializable, VotingEscrowCallback {
    using SafeERC20 for IERC20;

    // user info
    struct UserInfo {
        uint256 amount; // Amount of tokens the user staked.
        uint256 workingPower; // boosted user share.
        uint256 rewardPerShare; // Accumulated reward per share.
    }

    // global info
    address public lpToken;
    uint256 public lastRewardTime; // Last timestamp that SYM distribution occurs.
    uint256 public totalStaked; // Total token staked.
    uint256 public totalWorkingPower; // Total boosted working power.
    uint256 public accRewardPerShare; // Accumulated reward per working power.

    // states
    address public symToken;
    address public votingEscrow;
    address public symRate;
    // user_working_power = min(
    //   user_stake_amount,
    //   k% * user_stake_amount + (1 - k%) * total_stake_amount * (user_veSYM / total_veSYM)
    // )
    uint256 public k;

    // Info of each user that stakes LP tokens.
    mapping(address => UserInfo) public userInfo;

    event Deposit(address indexed user, uint256 amount);
    event Withdraw(address indexed user, uint256 amount);
    event UpdateWorkingPower(address indexed user, uint256 workingPower);

    function initialize(
        address _votingEscrow,
        address _symRate,
        address _symToken,
        uint256 _startTime
    ) external onlyInitializeOnce {
        symRate = _symRate;
        symToken = _symToken;
        votingEscrow = _votingEscrow;
        lastRewardTime = _startTime;

        k = 33;
    }

    function update() external {
        _update();
    }

    // Update reward
    function _update() internal {
        if (block.timestamp <= lastRewardTime) {
            return;
        }
        if (totalStaked == 0) {
            lastRewardTime = block.timestamp;
            return;
        }
        uint256 reward = ISYMRate(symRate).getSum(
            lastRewardTime,
            block.timestamp
        );
        // update prefix sum
        accRewardPerShare +=
            (reward * (10 ** IERC20Metadata(lpToken).decimals())) /
            totalWorkingPower;
        lastRewardTime = block.timestamp;
    }

    function _updateUser(address _user) internal returns (uint256 reward) {
        UserInfo storage user = userInfo[_user];
        reward =
            (user.workingPower * (accRewardPerShare - user.rewardPerShare)) /
            (10 ** IERC20Metadata(lpToken).decimals());
        user.rewardPerShare = accRewardPerShare;
        // distribute SYM reward and vest
        if (reward > 0) {
            ISYM(symToken).mint(votingEscrow, reward);
            IVotingEscrow(votingEscrow).vest(_user, reward);
        }
    }

    function _checkpoint(address _user) internal {
        IVotingEscrow votingEscrow_ = IVotingEscrow(votingEscrow);

        UserInfo storage user = userInfo[_user];
        uint256 newWorkingPower = (k * user.amount) / 100;
        uint256 votingTotal = votingEscrow_.totalSupply();
        if (votingTotal > 0)
            newWorkingPower +=
                (((totalStaked * votingEscrow_.balanceOf(_user)) /
                    votingTotal) * (100 - k)) /
                100;
        if (newWorkingPower > user.amount) newWorkingPower = user.amount;
        totalWorkingPower =
            totalWorkingPower +
            newWorkingPower -
            user.workingPower;
        user.workingPower = newWorkingPower;
        emit UpdateWorkingPower(_user, newWorkingPower);
    }

    function deposit(uint256 _amount) external returns (uint256 reward) {
        _update();
        reward = _updateUser(msg.sender);
        UserInfo storage user = userInfo[msg.sender];
        if (_amount > 0) {
            IERC20(lpToken).safeTransferFrom(
                address(msg.sender),
                address(this),
                _amount
            );
            user.amount += _amount;
            totalStaked += _amount;
        }
        _checkpoint(msg.sender);
        emit Deposit(msg.sender, _amount);
    }

    function withdraw(uint256 _amount) external returns (uint256 reward) {
        UserInfo storage user = userInfo[msg.sender];
        require(user.amount >= _amount, "LiquidityGauge: bad withdraw amount");

        _update();
        reward = _updateUser(msg.sender);
        if (_amount > 0) {
            user.amount -= _amount;
            totalStaked -= _amount;
            IERC20(lpToken).safeTransfer(address(msg.sender), _amount);
        }
        _checkpoint(msg.sender);
        emit Withdraw(msg.sender, _amount);
    }

    // kick someone from boosting if his/her locked share expired
    function kick(address _user) external {
        require(
            IVotingEscrow(votingEscrow).balanceOf(_user) == 0,
            "LiquidityGauge: user locked balance is not zero"
        );
        UserInfo storage user = userInfo[_user];
        uint256 oldWorkingPower = user.workingPower;
        _update();
        _updateUser(_user);
        _checkpoint(_user);
        require(
            oldWorkingPower > user.workingPower,
            "LiquidityGauge: user working power is up-to-date"
        );
    }

    function syncWithVotingEscrow(address _account) external override {
        _update();
        _updateUser(_account);
        _checkpoint(_account);
    }
}
