// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface INFTDescriptor {
    struct TokenURIParams {
        uint tokenId;
        uint tokenSalt;
        uint value;
    }

    function constructTokenURI(TokenURIParams memory _params) external pure returns (string memory);
}