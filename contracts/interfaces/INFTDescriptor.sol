// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

interface INFTDescriptor {
    struct TokenURIParams {
        uint tokenId;
        uint tokenSalt;
        uint value;
        uint ts;
    }

    struct RareEvent {
        uint start;
        uint end;
        uint rate;
    }

    function isRare(uint _salt, uint _ts) external view returns (bool);

    function constructTokenURI(TokenURIParams memory _params) external view returns (string memory);
}
