// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

import "./VotingEscrowCallback.sol";

contract VotingEscrowCallbackRelayer is VotingEscrowCallback, Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;

    event CallbackHandleAdded(address callbackHandle);
    event CallbackHandleRemoved(address callbackHandle);

    EnumerableSet.AddressSet private _handles;

    function getCallbackHandles()
        external
        view
        returns (address[] memory handles)
    {
        uint256 length = _handles.length();
        handles = new address[](length);
        for (uint256 i = 0; i < length; i++) {
            handles[i] = _handles.at(i);
        }
    }

    function addCallbackHandle(address callbackHandle) external onlyOwner {
        if (_handles.add(callbackHandle)) {
            emit CallbackHandleAdded(callbackHandle);
        }
    }

    function removeCallbackHandle(address callbackHandle) external onlyOwner {
        if (_handles.remove(callbackHandle)) {
            emit CallbackHandleRemoved(callbackHandle);
        }
    }

    function syncWithVotingEscrow(address _account) external override {
        uint256 len = _handles.length();
        for (uint256 i = 0; i < len; ++i) {
            VotingEscrowCallback(_handles.at(i)).syncWithVotingEscrow(_account);
        }
    }
}
