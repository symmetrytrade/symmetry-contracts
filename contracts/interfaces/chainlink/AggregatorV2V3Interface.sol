// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface AggregatorV2V3Interface {
    function latestAnswer() external view returns (int);

    function latestTimestamp() external view returns (uint);

    function latestRound() external view returns (uint);

    function getAnswer(uint roundId) external view returns (int);

    function getTimestamp(uint roundId) external view returns (uint);

    function decimals() external view returns (uint8);

    function description() external view returns (string memory);

    function version() external view returns (uint);

    function getRoundData(
        uint80 _roundId
    ) external view returns (uint80 roundId, int answer, uint startedAt, uint updatedAt, uint80 answeredInRound);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int answer, uint startedAt, uint updatedAt, uint80 answeredInRound);
}
