// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

interface INFTDescriptor {
    struct TokenURIParams {
        uint tokenId;
        uint tokenSalt;
        uint value;
        uint ts;
    }

    function constructTokenURI(TokenURIParams memory _params) external pure returns (string memory);
}
