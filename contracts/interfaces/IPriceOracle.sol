// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IPriceOracle {
    function aggregators(address) external view returns (address);

    function assetIds(address) external view returns (bytes32);

    function getLatestChainlinkPrice(
        address _token
    ) external view returns (uint80, uint256, uint256);

    function getPrice(
        address _token,
        bool _mustUsePyth
    ) external view returns (int256);

    function getPythPrice(
        address _token
    ) external view returns (uint256, int256);

    function gracePeriodTime() external view returns (uint256);

    function pythOracle() external view returns (address);

    function sequencerUptimeFeed() external view returns (address);

    function settings() external view returns (address);

    function updatePythPrice(
        address _sender,
        bytes[] calldata _priceUpdateData
    ) external payable;
}
