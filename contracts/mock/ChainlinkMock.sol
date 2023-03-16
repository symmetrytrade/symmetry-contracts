// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Chainlink mock contract for local test
contract ChainlinkMock {
    uint8 public decimals;
    uint80 public roundId;
    mapping(uint256 => int256) public answers;

    constructor(uint8 _decimals) {
        decimals = _decimals;
    }

    function feed(int256 _answer) external {
        ++roundId;
        answers[roundId] = _answer;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        require(roundId > 0, "ChainlinkMock: no price");
        return (roundId, answers[roundId], 0, 0, roundId);
    }
}
