// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import {Attestation} from "@eas/contracts/IEAS.sol";

import {ScrollBadgeEligibilityCheck} from "canvas-contracts/src/badge/extensions/ScrollBadgeEligibilityCheck.sol";
import {ScrollBadgeNonRevocable} from "canvas-contracts/src/badge/extensions/ScrollBadgeNonRevocable.sol";
import {ScrollBadgeSingleton} from "canvas-contracts/src/badge/extensions/ScrollBadgeSingleton.sol";
import {ScrollBadge} from "canvas-contracts/src/badge/ScrollBadge.sol";
import {Unauthorized} from "canvas-contracts/src/Errors.sol";

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

import "../interfaces/IVolumeTracker.sol";
import "../utils/Initializable.sol";
import "../utils/CommonContext.sol";

contract ScrollBadgeTradingVol is
    CommonContext,
    ScrollBadgeEligibilityCheck,
    ScrollBadgeNonRevocable,
    ScrollBadgeSingleton,
    AccessControlEnumerable,
    Initializable
{
    uint internal constant WEEK_PER_YEAR = 52;

    address public volumeTracker;
    uint[] public tiers;
    mapping(uint => string) public tokenURIs;
    mapping(bytes32 => address) public uidOwner;

    constructor(address resolver_) ScrollBadge(resolver_) {
        // empty
    }

    function initialize(address _volumeTracker) external onlyInitializeOnce {
        volumeTracker = _volumeTracker;

        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // tiers

    function setTiers(uint[] memory _tiers, string[] memory _uris) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_tiers.length == _uris.length, "ScrollBadgeTradingVol: length mismatch");
        uint n = _tiers.length;
        for (uint i = 0; i < n; ++i) {
            tokenURIs[_tiers[i]] = _uris[i];
        }
        tiers = _tiers;
    }

    function _getTier(uint _volume) internal view returns (uint tier) {
        uint n = tiers.length;
        for (uint i = 0; i < n; ++i) {
            if (tiers[i] > _volume) {
                break;
            }
            tier = tiers[i];
        }
    }

    function _checkTier(address _account) internal view returns (uint) {
        IVolumeTracker volumeTracker_ = IVolumeTracker(volumeTracker);
        uint ts = _startOfWeek(block.timestamp);
        uint volume = 0;
        for (uint i = 0; i < WEEK_PER_YEAR; ++i) {
            volume += volumeTracker_.userWeeklyVolume(_account, ts);
            ts -= 1 weeks;
        }
        return _getTier(volume);
    }

    /// @inheritdoc ScrollBadge
    function onIssueBadge(
        Attestation calldata attestation
    ) internal override(ScrollBadge, ScrollBadgeNonRevocable, ScrollBadgeSingleton) returns (bool) {
        if (!super.onIssueBadge(attestation)) {
            return false;
        }

        uint tier = _checkTier(attestation.recipient);
        if (tier == 0) {
            revert Unauthorized();
        }
        uidOwner[attestation.uid] = attestation.recipient;

        return true;
    }

    /// @inheritdoc ScrollBadge
    function onRevokeBadge(
        Attestation calldata attestation
    ) internal override(ScrollBadge, ScrollBadgeSingleton) returns (bool) {
        if (!super.onRevokeBadge(attestation)) {
            return false;
        }

        return true;
    }

    /// @inheritdoc ScrollBadgeEligibilityCheck
    function isEligible(address recipient) external view override returns (bool) {
        return !hasBadge(recipient) && _checkTier(recipient) > 0;
    }

    function badgeTokenURI(bytes32 uid) public view override returns (string memory) {
        return tokenURIs[_checkTier(uidOwner[uid])];
    }
}
