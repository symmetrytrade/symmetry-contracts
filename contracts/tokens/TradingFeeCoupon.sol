// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/AccessControlEnumerable.sol";

import "../interfaces/ITradingFeeCoupon.sol";
import "../interfaces/INFTDescriptor.sol";

contract TradingFeeCoupon is ITradingFeeCoupon, ERC721, AccessControlEnumerable {
    // constants
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant SPENDER_ROLE = keccak256("SPENDER_ROLE");

    // states
    uint public tokenCount;
    mapping(uint => uint) public couponValues;
    mapping(address => uint) public unspents;
    Mintable[] public mintables;
    mapping(uint => uint) public tokenSalt;
    mapping(uint => uint) public mintDate;
    address public descriptor;

    constructor(string memory _name, string memory _symbol) ERC721(_name, _symbol) {
        mintables.push(Mintable(address(0), 0, 0));

        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function setDescriptor(address _descriptor) external onlyRole(DEFAULT_ADMIN_ROLE) {
        descriptor = _descriptor;
    }

    function supportsInterface(
        bytes4 interfaceId
    ) public view override(ERC721, AccessControlEnumerable) returns (bool) {
        return ERC721.supportsInterface(interfaceId) || AccessControlEnumerable.supportsInterface(interfaceId);
    }

    function preMint(address _to, uint _value, uint _expire) external onlyRole(MINTER_ROLE) returns (uint id) {
        id = mintables.length;
        mintables.push(Mintable({to: _to, value: _value, expire: _expire}));
        emit PreMint(id, _to, _value, _expire);
    }

    function mint(uint _preMintId) external {
        _mintFromPreMint(_preMintId);
    }

    function mintAndApply(uint _preMintId) external {
        uint id = _mintFromPreMint(_preMintId);
        _applyCoupon(mintables[_preMintId].to, id);
    }

    function _mintFromPreMint(uint _preMintId) internal returns (uint id) {
        require(_preMintId < mintables.length, "TradingFeeCoupon: invalid pre-mint id");
        Mintable memory mintable = mintables[_preMintId];
        require(mintable.expire > 0, "TradingFeeCoupon: minted");
        require(mintable.expire > block.timestamp, "TradingFeeCoupon: expired");
        mintables[_preMintId].expire = 0;

        emit PreMintConsumed(_preMintId);
        return _mintCoupon(mintable.to, mintable.value);
    }

    function mintCoupon(address _to, uint _value) external onlyRole(MINTER_ROLE) {
        _mintCoupon(_to, _value);
    }

    function applyCoupons(uint[] memory _ids) external {
        uint len = _ids.length;
        for (uint i = 0; i < len; ++i) {
            _applyCoupon(msg.sender, _ids[i]);
        }
    }

    function _mintCoupon(address _to, uint _value) internal returns (uint id) {
        id = tokenCount;
        couponValues[id] = _value;
        tokenSalt[id] = uint(keccak256(abi.encodePacked(blockhash(block.number - 1), id, _value)));
        mintDate[id] = block.timestamp;
        _mint(_to, id);
        tokenCount = id + 1;

        emit Minted(id, _to, _value);
    }

    function _applyCoupon(address _account, uint _id) internal {
        require(_account != address(0), "TradingFeeCoupont: zero address");
        require(_ownerOf(_id) == _account, "TradingFeeCoupon: not owner");

        unspents[_account] += couponValues[_id];
        _burn(_id);

        emit Applied(_id, _account, couponValues[_id]);
    }

    function spend(address _account, uint _amount) external onlyRole(SPENDER_ROLE) {
        require(unspents[_account] >= _amount, "TradingFeeCoupon: insufficient unspents");

        unspents[_account] -= _amount;

        emit Spent(_account, _amount);
    }

    function tokenURI(uint256 _tokenId) public view virtual override returns (string memory) {
        _requireMinted(_tokenId);

        return
            INFTDescriptor(descriptor).constructTokenURI(
                INFTDescriptor.TokenURIParams({
                    tokenId: _tokenId,
                    tokenSalt: tokenSalt[_tokenId],
                    value: couponValues[_tokenId],
                    ts: mintDate[_tokenId]
                })
            );
    }
}
