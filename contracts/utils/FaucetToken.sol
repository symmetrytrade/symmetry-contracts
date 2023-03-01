// SPDX-License-Identifier: MIT

pragma solidity ^0.8.2;

import "../tokenomics/ERC20.sol";

contract FaucetToken is ERC20 {
    constructor(
        string memory _name,
        string memory _symbol
    ) ERC20(_name, _symbol) {}

    function mint(address _to, uint256 _amount) external {
        _mint(_to, _amount);
    }

    function burn(uint256 _amount) external {
        _burn(msg.sender, _amount);
    }
}
