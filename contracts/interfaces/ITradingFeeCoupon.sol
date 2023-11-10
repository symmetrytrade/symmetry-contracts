// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

interface ITradingFeeCoupon {
    /*=== struct ===*/

    struct Mintable {
        address to;
        uint value;
        uint expire;
    }

    /*=== event ===*/

    event PreMint(uint id, address receiver, uint value, uint expire);
    event PreMintConsumed(uint id);
    event Minted(uint id, address receiver, uint value);
    event Applied(uint id, address account, uint value);
    event Spent(address account, uint amount);

    /*=== function ===*/

    function couponValues(uint) external view returns (uint);

    function mint(uint _preMintId) external;

    function mintAndApply(uint _preMintId) external;

    function mintCoupon(address _to, uint _value) external;

    function mintables(uint) external view returns (address to, uint value, uint expire);

    function preMint(address _to, uint _value, uint _expire) external returns (uint id);

    function applyCoupons(uint[] memory _ids) external;

    function spend(address _account, uint _amount) external;

    function unspents(address) external view returns (uint);
}
