// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../access/Ownable.sol";
import "../interfaces/chainlink/AggregatorV2V3Interface.sol";
import "../interfaces/pyth/IPyth.sol";
import "../utils/Initializable.sol";

contract PriceOracle is Ownable, Initializable {
    uint256 public constant PRICE_PRECISION = 18;

    // chainlink price feed aggregators
    mapping(address => address) public aggregators;
    // chainlink L2 Sequencer Uptime Feeds
    address public sequencerUptimeFeed;
    uint256 public gracePeriodTime;

    // pyth asset ids
    mapping(address => bytes32) public assetIds;
    // pyth oracle
    address public pythOracle;

    /*=== initialize ===*/
    function initialize() external onlyInitializeOnce {
        _transferOwnership(msg.sender);
    }

    /*=== owner ===*/

    function setChainlinkSequencerUptimeFeed(
        address _sequencerUptimeFeed,
        uint256 _gracePeriodTime
    ) public onlyOwner {
        sequencerUptimeFeed = _sequencerUptimeFeed;
        gracePeriodTime = _gracePeriodTime;
    }

    function setChainlinkAggregators(
        address[] calldata _tokens,
        address[] calldata _aggregators
    ) external onlyOwner {
        require(
            _tokens.length == _aggregators.length,
            "PriceOracle: length not match"
        );
        for (uint i = 0; i < _tokens.length; ++i)
            aggregators[_tokens[i]] = _aggregators[i];
    }

    function setPythOracle(address _pythOracle) external onlyOwner {
        pythOracle = _pythOracle;
    }

    /*=== price ===*/

    function _checkSequencer() internal view {
        if (sequencerUptimeFeed != address(0)) {
            (, int256 answer, uint256 startedAt, , ) = AggregatorV2V3Interface(
                sequencerUptimeFeed
            ).latestRoundData();
            require(answer == 0, "PriceOracle: Sequencer is down");
            require(
                block.timestamp - startedAt > gracePeriodTime,
                "PriceOracle: Grace period not over"
            );
        }
    }

    /// @notice get latest price from chainlink
    /// @param _token token address
    /// @return round id, normalized price
    function getLatestChainlinkPrice(
        address _token
    ) external view returns (uint80, uint256) {
        _checkSequencer();
        AggregatorV2V3Interface aggregator = AggregatorV2V3Interface(
            aggregators[_token]
        );
        (uint80 roundID, int price, , , ) = aggregator.latestRoundData();
        require(price > 0, "PriceOracle: invalid Chainlink price");
        uint256 normalizedPrice = uint256(price);
        uint8 decimals = aggregator.decimals();
        if (decimals > PRICE_PRECISION) {
            normalizedPrice =
                normalizedPrice /
                (10 ** (decimals - PRICE_PRECISION));
        } else if (decimals < PRICE_PRECISION) {
            normalizedPrice =
                normalizedPrice *
                (10 ** (PRICE_PRECISION - decimals));
        }
        return (roundID, normalizedPrice);
    }

    function getPythPrice(
        address _token,
        uint256 age
    ) external view returns (uint256, uint256) {
        bytes32 assetId = assetIds[_token];
        require(assetId != bytes32(0), "PriceOracle: undefined pyth asset");
        PythStructs.Price memory price = IPyth(pythOracle).getPriceNoOlderThan(
            assetId,
            age
        );
        require(price.price > 0, "PriceOracle: invalid Pyth price");
        uint256 normalizedPrice = uint256(uint64(price.price));
        if (price.expo < -int(PRICE_PRECISION))
            normalizedPrice =
                normalizedPrice /
                (10 ** uint(-price.expo - int(PRICE_PRECISION)));
        else if (price.expo > -int(PRICE_PRECISION))
            normalizedPrice =
                normalizedPrice *
                (10 ** uint(int(PRICE_PRECISION) + price.expo));
        return (price.publishTime, normalizedPrice);
    }

    /// @notice update pyth price, refund remaining fee to sender
    /// @param _sender sender address
    /// @param _priceUpdateData update data for pyth oracle
    function updatePythPrice(
        address _sender,
        bytes[] calldata _priceUpdateData
    ) external payable {
        IPyth pythOracle_ = IPyth(pythOracle);

        uint256 fee = pythOracle_.getUpdateFee(_priceUpdateData);
        require(msg.value >= fee, "PriceOracle: insufficient fee");

        pythOracle_.updatePriceFeeds{value: fee}(_priceUpdateData);

        if (msg.value > fee) {
            payable(_sender).transfer(msg.value - fee);
        }
    }
}
