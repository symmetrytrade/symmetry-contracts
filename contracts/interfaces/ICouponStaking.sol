// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

interface ICouponStaking {
    /*=== struct ===*/

    struct Discount {
        uint discount;
        uint ts;
    }

    /*=== function ===*/

    function coupon() external view returns (address);

    function getDiscount(address _account) external view returns (uint256);

    function getStaked(address _account) external view returns (uint256[] memory);

    function stake(uint256[] memory _ids) external;
}
