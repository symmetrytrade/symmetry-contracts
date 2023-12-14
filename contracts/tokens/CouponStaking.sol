// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";

import "../interfaces/INFTDescriptor.sol";
import "../interfaces/ITradingFeeCoupon.sol";
import "../interfaces/ICouponStaking.sol";

import "../utils/Initializable.sol";

contract CouponStaking is ICouponStaking, AccessControlEnumerable, Initializable {
    // reserved storage slots for base contract upgrade in future
    uint256[50] private __gap;

    // discount end timestamp
    uint public immutable discountStart;
    uint public immutable discountEnd;

    address public coupon;
    mapping(address => uint[]) private staked;
    mapping(address => Discount) private discounts;

    constructor(uint _start, uint _end) {
        discountStart = _start;
        discountEnd = _end;
    }

    function initialize(address _admin, address _coupon) external onlyInitializeOnce {
        coupon = _coupon;

        _setupRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    function getStaked(address _account) external view returns (uint[] memory) {
        return staked[_account];
    }

    /*=== stake ===*/

    function _computeDiscount(address _account) internal view returns (uint) {
        return staked[_account].length > 10000 ? 0 : 0;
    }

    function _snapshotDiscount(address _account) internal {
        Discount storage discount = discounts[_account];
        discount.ts = block.timestamp;
        discount.discount = _computeDiscount(_account);
    }

    function stake(uint[] memory _ids) external {
        IERC721 coupon_ = IERC721(coupon);

        uint[] memory old = staked[msg.sender];
        for (uint i = 0; i < old.length; ++i) {
            coupon_.safeTransferFrom(address(this), msg.sender, old[i]);
        }
        for (uint i = 0; i < _ids.length; ++i) {
            coupon_.safeTransferFrom(msg.sender, address(this), _ids[i]);
        }
        staked[msg.sender] = _ids;
        _snapshotDiscount(msg.sender);
        require(_ids.length == 0 || discounts[msg.sender].discount > 0, "CouponStaking: cannot get discount");
    }

    /*=== campaigns ===*/

    function getDiscount(address _account) external view returns (uint) {
        Discount memory discount = discounts[_account];
        return
            discount.ts >= discountStart &&
                discount.ts <= discountEnd &&
                block.timestamp >= discountStart &&
                block.timestamp <= discountEnd
                ? discount.discount
                : 0;
    }
}
