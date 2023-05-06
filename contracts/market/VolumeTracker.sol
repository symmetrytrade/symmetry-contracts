// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

import "../utils/SafeDecimalMath.sol";
import "../utils/Initializable.sol";
import "../utils/CommonContext.sol";

import "../interfaces/IMarket.sol";
import "../interfaces/IVolumeTracker.sol";
import "../interfaces/ITradingFeeCoupon.sol";

import "./MarketSettings.sol";
import "./MarketSettingsContext.sol";

contract VolumeTracker is
    IVolumeTracker,
    CommonContext,
    MarketSettingsContext,
    Ownable,
    Initializable
{
    using SafeDecimalMath for uint256;
    using SignedSafeDecimalMath for int256;
    using SafeCast for uint256;
    using SafeCast for int256;

    // states
    address public market;
    address public settings;
    address public coupon;

    mapping(address => mapping(uint256 => uint256)) public userWeeklyVolume;
    mapping(address => mapping(uint256 => uint256)) public userDailyVolume;

    mapping(address => mapping(uint256 => bool)) public weeklyCouponClaimed;
    mapping(address => mapping(uint256 => bool)) public dailyCouponClaimed;

    mapping(uint256 => uint256) public luckyCandidates;
    mapping(uint256 => uint256) public winningNumber;
    mapping(address => mapping(uint256 => uint256)) public userLuckyNumber;

    Tier[] public rebateTiers; // trading fee rebate tiers

    /*=== modifers ===*/
    modifier onlyMarket() {
        require(msg.sender == market, "PerpTracker: sender is not market");
        _;
    }

    function initialize(
        address _market,
        address _coupon
    ) external onlyInitializeOnce {
        market = _market;
        coupon = _coupon;
        settings = IMarket(_market).settings();

        _transferOwnership(msg.sender);
    }

    /*=== owner ===*/

    function setMarket(address _market) external onlyOwner {
        market = _market;
    }

    function setSetting(address _settings) external onlyOwner {
        settings = _settings;
    }

    function setCoupon(address _coupon) external onlyOwner {
        coupon = _coupon;
    }

    function setRebateTiers(Tier[] memory _tiers) external onlyOwner {
        delete rebateTiers;

        uint len = _tiers.length;
        for (uint i = 0; i < len; ++i) {
            rebateTiers.push(_tiers[i]);
        }
    }

    /*=== volume ===*/
    function logTrade(address _account, uint256 _volume) external onlyMarket {
        _addDailyVolume(_account, _volume);
        _addWeeklyVolume(_account, _volume);
    }

    function _addDailyVolume(address _account, uint256 _volume) internal {
        IMarketSettings settings_ = IMarketSettings(settings);

        uint256 t = _startOfDay(block.timestamp);
        uint256 totalVol = userDailyVolume[_account][t] + _volume;
        userDailyVolume[_account][t] = totalVol;

        uint256 n = (totalVol /
            uint(settings_.getIntVals(ONE_DRAW_REQUIREMENT))).min(10);
        for (uint i = 0; i < n; ++i) {
            if (userLuckyNumber[_account][t] == 0) {
                uint256 num = luckyCandidates[t] + 1;
                luckyCandidates[t] = num;
                userLuckyNumber[_account][t] = num;
                winningNumber[t] =
                    uint(keccak256(abi.encodePacked(block.difficulty, t))) %
                    10;
            }
            t += 1 days;
        }
    }

    function _addWeeklyVolume(address _account, uint256 _volume) internal {
        userWeeklyVolume[_account][_startOfWeek(block.timestamp)] += _volume;
    }

    /*=== weekly trading fee coupon ===*/
    function _rebateRatio(uint256 _volume) internal view returns (uint256) {
        uint len = rebateTiers.length;
        for (uint i = 0; i < len; ++i)
            if (_volume >= rebateTiers[i].requirement) {
                return rebateTiers[i].rebateRatio;
            }
        return 0;
    }

    function claimWeeklyTradingFeeCoupon(uint256 _t) external {
        _t = _startOfWeek(_t);
        require(
            _t < _startOfWeek(block.timestamp),
            "VolumeTracker: invalid date"
        );

        require(
            !weeklyCouponClaimed[msg.sender][_t],
            "VolumeTracker: claimed already"
        );
        weeklyCouponClaimed[msg.sender][_t] = true;

        uint256 volume = userWeeklyVolume[msg.sender][_t];
        uint256 rebateRatio = _rebateRatio(volume);
        if (rebateRatio > 0) {
            uint256 value = IMarketSettings(settings)
                .getIntVals(PERP_TRADING_FEE)
                .toUint256()
                .multiplyDecimal(volume)
                .multiplyDecimal(rebateRatio);
            ITradingFeeCoupon(coupon).mintCoupon(msg.sender, value);
        }
    }

    /*=== I'm feeling lucky ===*/
    function claimLuckyCoupon(uint256 _t) external {
        _t = _startOfDay(_t);
        require(
            _t < _startOfDay(block.timestamp),
            "VolumeTracker: invalid date"
        );

        require(
            !dailyCouponClaimed[msg.sender][_t],
            "VolumeTracker: claimed already"
        );
        dailyCouponClaimed[msg.sender][_t] = true;

        uint256 num = userLuckyNumber[msg.sender][_t];
        require(num > 0, "VolumeTracker: no chance");
        if (num % 10 == winningNumber[_t]) {
            ITradingFeeCoupon(coupon).mintCoupon(
                msg.sender,
                uint(MarketSettings(settings).getIntVals(ONE_DRAW_REWARD))
            );
        }
    }
}
