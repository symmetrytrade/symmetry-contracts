// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISYM {
    function mint(address _to, uint _amount) external;

    function burn(uint _amount) external;
}
