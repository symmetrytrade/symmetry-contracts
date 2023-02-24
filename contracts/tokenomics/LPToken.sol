// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../access/AccessControlEnumerable.sol";
import "../utils/Initializable.sol";

contract LPToken is AccessControlEnumerable, Initializable {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    mapping(address => uint256) private _balances;
    mapping(address => mapping(address => uint256)) private _allowances;
    uint256 private _totalSupply;
    string public name;
    string public symbol;
    uint8 public decimals;

    event Transfer(address indexed from, address indexed to, uint256 value);

    function initialize(
        string memory _name,
        string memory _symbol,
        uint8 _decimals
    ) public onlyInitializeOnce {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;

        _setupRole(DEFAULT_ADMIN_ROLE, _msgSender());
    }

    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    function totalSupply() public view returns (uint256) {
        return _totalSupply;
    }

    function mint(address to, uint256 amount) public virtual {
        require(
            hasRole(MINTER_ROLE, _msgSender()),
            "LPToken: must have minter role to mint"
        );
        _mint(to, amount);
    }

    function burn(address account, uint256 amount) public virtual {
        require(
            hasRole(MINTER_ROLE, _msgSender()),
            "LPToken: must have minter role to burn"
        );
        _burn(account, amount);
    }

    function _mint(address account, uint256 amount) internal virtual {
        require(account != address(0), "LpToken: mint to the zero address");

        _totalSupply += amount;
        unchecked {
            // Overflow not possible: balance + amount is at most totalSupply + amount, which is checked above.
            _balances[account] += amount;
        }
        emit Transfer(address(0), account, amount);
    }

    function _burn(address account, uint256 amount) internal virtual {
        require(account != address(0), "LpToken: burn from the zero address");

        uint256 accountBalance = _balances[account];
        require(
            accountBalance >= amount,
            "LpToken: burn amount exceeds balance"
        );
        unchecked {
            _balances[account] = accountBalance - amount;
            // Overflow not possible: amount <= accountBalance <= totalSupply.
            _totalSupply -= amount;
        }

        emit Transfer(account, address(0), amount);
    }
}
