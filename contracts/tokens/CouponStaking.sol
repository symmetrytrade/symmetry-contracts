// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import "../interfaces/INFTDescriptor.sol";
import "../interfaces/ITradingFeeCoupon.sol";
import "../interfaces/ICouponStaking.sol";

import "../utils/Initializable.sol";

contract CouponStaking is ICouponStaking, AccessControlEnumerable, Initializable {
    address public coupon;
    mapping(address => uint[]) private staked;

    function initialize(address _admin, address _coupon) external onlyInitializeOnce {
        coupon = _coupon;

        _setupRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    function getStaked(address _account) external view returns (uint[] memory) {
        return staked[_account];
    }

    /*=== stake ===*/

    function stake(uint[] memory _ids) external {
        IERC721 coupon_ = IERC721(coupon);

        uint[] memory old = staked[msg.sender];
        for (uint i = 0; i < old.length; ++i) {
            coupon_.safeTransferFrom(address(this), msg.sender, old[i]);
        }
        for (uint i = 0; i < _ids.length; ++i) {
            coupon_.safeTransferFrom(msg.sender, address(this), _ids[i]);
        }
    }

    /*=== campaigns ===*/

    function getDiscount(address _account) external view returns (uint) {
        // TODO: calculate discount by user staked coupons
        return staked[_account].length > 10000 ? 0 : 0;
    }
}
