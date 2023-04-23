// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

contract TradingFeeCoupon is ERC721, AccessControlEnumerable {
    // constants
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant SPENDER_ROLE = keccak256("SPENDER_ROLE");

    // states
    string private tokenBaseURI;
    uint256 public tokenCount;
    mapping(uint256 => uint256) public couponValues;

    // events
    event Minted(uint256 id, address receiver, uint256 value);
    event Spent(uint256 id, uint256 amount);

    constructor(
        string memory _name,
        string memory _symbol,
        string memory _tokenBaseURI
    ) ERC721(_name, _symbol) {
        tokenBaseURI = _tokenBaseURI;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, AccessControlEnumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function mint(address _to, uint256 _value) external {
        require(
            hasRole(MINTER_ROLE, msg.sender),
            "TradingFeeCoupon: must have minter role to mint"
        );

        couponValues[tokenCount] = _value;
        _safeMint(_to, tokenCount);
        ++tokenCount;

        emit Minted(tokenCount - 1, _to, _value);
    }

    function spend(uint256 _id, uint256 _amount) external {
        require(
            hasRole(MINTER_ROLE, msg.sender),
            "TradingFeeCoupon: must have minter role to mint"
        );
        require(
            couponValues[_id] >= _amount,
            "TradingFeeCoupon: insufficient value"
        );

        couponValues[_id] -= _amount;

        emit Spent(_id, _amount);
    }
}
