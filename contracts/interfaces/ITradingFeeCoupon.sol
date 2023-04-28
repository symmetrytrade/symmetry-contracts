// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ITradingFeeCoupon {
    /*=== struct ===*/

    struct Mintable {
        address to;
        uint256 value;
        uint256 expire;
    }

    /*=== event ===*/

    event PreMint(uint256 id, address receiver, uint256 value, uint256 expire);
    event Minted(uint256 id, address receiver, uint256 value);
    event Redeem(uint256 id, address account, uint256 value);
    event Spent(address account, uint256 amount);

    /*=== function ===*/

    function couponValues(uint256) external view returns (uint256);

    function mint(uint256 _preMintId) external;

    function mintAndRedeem(address _to, uint256 _value) external;

    function mintCoupon(address _to, uint256 _value) external;

    function mintables(
        uint256
    ) external view returns (address to, uint256 value, uint256 expire);

    function preMint(
        address _to,
        uint256 _value,
        uint256 _expire
    ) external returns (uint256 id);

    function redeemCoupon(uint256 _id) external;

    function spend(address _account, uint256 _amount) external;

    function unspents(address) external view returns (uint256);
}
