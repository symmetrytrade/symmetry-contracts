// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

import "../interfaces/ITradingFeeCoupon.sol";

contract TradingFeeCoupon is
    ITradingFeeCoupon,
    ERC721,
    AccessControlEnumerable
{
    // constants
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant SPENDER_ROLE = keccak256("SPENDER_ROLE");

    // states
    string private tokenBaseURI;
    uint256 public tokenCount;
    mapping(uint256 => uint256) public couponValues;
    mapping(address => uint256) public unspents;
    Mintable[] public mintables;

    constructor(
        string memory _name,
        string memory _symbol,
        string memory _tokenBaseURI
    ) ERC721(_name, _symbol) {
        tokenBaseURI = _tokenBaseURI;
        mintables.push(Mintable(address(0), 0, 0));

        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, AccessControlEnumerable) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function preMint(
        address _to,
        uint256 _value,
        uint256 _expire
    ) external returns (uint256 id) {
        require(
            hasRole(MINTER_ROLE, msg.sender),
            "TradingFeeCoupon: must have minter role to pre-mint"
        );

        id = mintables.length;
        mintables.push(Mintable({to: _to, value: _value, expire: _expire}));
        emit PreMint(id, _to, _value, _expire);
    }

    function mint(uint256 _preMintId) external {
        require(
            _preMintId < mintables.length,
            "TradingFeeCoupon: invalid pre-mint id"
        );
        Mintable memory mintable = mintables[_preMintId];
        require(mintable.expire > 0, "TradingFeeCoupon: minted");
        require(mintable.expire > block.timestamp, "TradingFeeCoupon: expired");
        mintables[_preMintId].expire = 0;

        _mintCoupon(mintable.to, mintable.value);
    }

    function mintCoupon(address _to, uint256 _value) external {
        require(
            hasRole(MINTER_ROLE, msg.sender),
            "TradingFeeCoupon: must have minter role to pre-mint"
        );

        _mintCoupon(_to, _value);
    }

    function mintAndRedeem(address _to, uint256 _value) external {
        require(
            hasRole(MINTER_ROLE, msg.sender),
            "TradingFeeCoupon: must have minter role to mint"
        );

        uint256 id = _mintCoupon(_to, _value);
        _redeemCoupon(_to, id);
    }

    function redeemCoupon(uint256 _id) external {
        _redeemCoupon(msg.sender, _id);
    }

    function _mintCoupon(
        address _to,
        uint256 _value
    ) internal returns (uint256 id) {
        id = tokenCount;
        couponValues[id] = _value;
        _safeMint(_to, id);
        ++tokenCount;

        emit Minted(id, _to, _value);
    }

    function _redeemCoupon(address _account, uint256 _id) internal {
        require(_account != address(0), "TradingFeeCoupont: zero address");
        require(_ownerOf(_id) == _account, "TradingFeeCoupon: not owner");

        unspents[_account] += couponValues[_id];
        _burn(_id);

        emit Redeem(_id, _account, couponValues[_id]);
    }

    function spend(address _account, uint256 _amount) external {
        require(
            hasRole(SPENDER_ROLE, msg.sender),
            "TradingFeeCoupon: must have spender role to spend"
        );
        require(
            unspents[_account] >= _amount,
            "TradingFeeCoupon: insufficient unspents"
        );

        unspents[_account] -= _amount;

        emit Spent(_account, _amount);
    }
}
