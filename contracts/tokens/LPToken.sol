// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract LPToken is ERC20, AccessControlEnumerable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    constructor(string memory _name, string memory _symbol) ERC20(_name, _symbol) {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function mint(address to, uint amount) public virtual {
        require(hasRole(MINTER_ROLE, msg.sender), "LPToken: must have minter role to mint");
        _mint(to, amount);
    }

    function burn(address account, uint amount) public virtual {
        require(hasRole(MINTER_ROLE, msg.sender), "LPToken: must have minter role to burn");
        _burn(account, amount);
    }
}
