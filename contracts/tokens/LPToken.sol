// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

import "../interfaces/ILiquidityGauge.sol";

contract LPToken is ERC20, AccessControlEnumerable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    address public liquidityGauge;

    constructor(string memory _name, string memory _symbol) ERC20(_name, _symbol) {
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function setLiquidityGauge(address _liquidityGauge) external {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "LPToken: forbid");
        liquidityGauge = _liquidityGauge;
    }

    function mint(address _to, uint _amount) public virtual {
        require(hasRole(MINTER_ROLE, msg.sender), "LPToken: must have minter role to mint");
        _mint(_to, _amount);
    }

    function mintAndStake(address _to, uint _amount) public virtual {
        require(hasRole(MINTER_ROLE, msg.sender), "LPToken: must have minter role to mint");
        _mint(liquidityGauge, _amount);
        ILiquidityGauge(liquidityGauge).depositAfterMint(_to, _amount);
    }

    function burn(address _account, uint _amount) public virtual {
        require(hasRole(MINTER_ROLE, msg.sender), "LPToken: must have minter role to burn");
        _burn(_account, _amount);
    }
}
