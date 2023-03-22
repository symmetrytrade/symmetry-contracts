// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

// Chainlink mock contract for local test
contract ChainlinkMock {
    uint8 public decimals;
    uint80 public roundId;
    mapping(uint256 => int256) public answers;
    mapping(uint256 => uint256) public updateTime;

    constructor(uint8 _decimals) {
        decimals = _decimals;
    }

    function feed(int256 _answer, uint256 _updatedAt) external {
        ++roundId;
        answers[roundId] = _answer;
        updateTime[roundId] = _updatedAt;
    }

    function latestRoundData()
        external
        view
        returns (uint80, int256, uint256, uint256, uint80)
    {
        require(roundId > 0, "ChainlinkMock: no price");
        return (roundId, answers[roundId], 0, updateTime[roundId], roundId);
    }
}
