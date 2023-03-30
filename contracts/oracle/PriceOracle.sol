// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../market/MarketSettings.sol";
import "../access/Ownable.sol";
import "../interfaces/chainlink/AggregatorV2V3Interface.sol";
import "../interfaces/pyth/IPyth.sol";
import "../utils/Initializable.sol";
import "../utils/SafeCast.sol";
import "../utils/SafeDecimalMath.sol";

contract PriceOracle is Ownable, Initializable {
    using SafeCast for int256;
    using SafeCast for uint256;
    using SafeDecimalMath for uint256;

    uint256 public constant PRICE_PRECISION = 18;

    // setting keys
    bytes32 public constant PYTH_MAX_AGE = "pythMaxAge";
    bytes32 public constant MAX_PRICE_DIVERGENCE = "maxPriceDivergence";

    // chainlink price feed aggregators
    mapping(address => address) public aggregators;
    // chainlink L2 Sequencer Uptime Feeds
    address public sequencerUptimeFeed;
    uint256 public gracePeriodTime;

    // pyth asset ids
    mapping(address => bytes32) public assetIds;
    // pyth oracle
    address public pythOracle;
    // market settings
    address public settings;

    /*=== initialize ===*/
    function initialize(address _settings) external onlyInitializeOnce {
        settings = _settings;

        _transferOwnership(msg.sender);
    }

    /*=== owner ===*/

    function setSetting(address _settings) external onlyOwner {
        settings = _settings;
    }

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

    function setPythIds(
        address[] calldata _tokens,
        bytes32[] calldata _ids
    ) external onlyOwner {
        require(_tokens.length == _ids.length, "PriceOracle: length not match");
        for (uint i = 0; i < _tokens.length; ++i)
            assetIds[_tokens[i]] = _ids[i];
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
    /// @return round id, updatedAt, normalized price
    function getLatestChainlinkPrice(
        address _token
    ) public view returns (uint80, uint256, uint256) {
        _checkSequencer();
        AggregatorV2V3Interface aggregator = AggregatorV2V3Interface(
            aggregators[_token]
        );
        (uint80 roundID, int price, , uint256 updatedAt, ) = aggregator
            .latestRoundData();
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
        return (roundID, updatedAt, normalizedPrice);
    }

    /**
     * @dev get pyth price updated within a time range
     * @param _token token to query
     * @return success, price publish time, normalized price
     */
    function getPythPrice(
        address _token
    ) public view returns (uint256, int256) {
        bytes32 assetId = assetIds[_token];
        require(assetId != bytes32(0), "PriceOracle: undefined pyth asset");
        PythStructs.Price memory price = IPyth(pythOracle).getPriceUnsafe(
            assetId
        );
        require(price.price > 0, "PriceOracle: invalid Pyth price");
        int256 normalizedPrice = int256(price.price);
        if (price.expo < -int(PRICE_PRECISION))
            normalizedPrice =
                normalizedPrice /
                int(10 ** uint(-price.expo - int(PRICE_PRECISION)));
        else if (price.expo > -int(PRICE_PRECISION))
            normalizedPrice =
                normalizedPrice *
                int(10 ** uint(int(PRICE_PRECISION) + price.expo));
        return (price.publishTime, normalizedPrice);
    }

    /// @notice update pyth price, refund remaining fee to sender
    /// @param _sender sender address
    /// @param _priceUpdateData update data for pyth oracle
    function updatePythPrice(
        address _sender,
        bytes[] calldata _priceUpdateData
    ) external payable {
        if (_priceUpdateData.length == 0) {
            payable(_sender).transfer(msg.value);
            return;
        }
        IPyth pythOracle_ = IPyth(pythOracle);

        uint256 fee = pythOracle_.getUpdateFee(_priceUpdateData);
        require(msg.value >= fee, "PriceOracle: insufficient fee");

        pythOracle_.updatePriceFeeds{value: fee}(_priceUpdateData);

        if (msg.value > fee) {
            payable(_sender).transfer(msg.value - fee);
        }
    }

    /// @notice get token's normalized usd price
    /// @param _token token address
    /// @param _mustUsePyth use price from pyth or not
    function getPrice(
        address _token,
        bool _mustUsePyth
    ) public view returns (int256) {
        MarketSettings settings_ = MarketSettings(settings);

        (, uint256 updatedAt, uint256 chainlinkPrice) = getLatestChainlinkPrice(
            _token
        );
        (uint256 publishTime, int256 pythPrice) = getPythPrice(_token);
        require(
            !_mustUsePyth ||
                publishTime + settings_.getUintVals(PYTH_MAX_AGE) >
                block.timestamp,
            "PriceOracle: pyth price too stale"
        );
        if (publishTime > updatedAt) {
            uint256 divergence = chainlinkPrice > pythPrice.toUint256()
                ? chainlinkPrice.divideDecimal(pythPrice.toUint256())
                : pythPrice.toUint256().divideDecimal(chainlinkPrice);
            require(
                divergence < settings_.getUintVals(MAX_PRICE_DIVERGENCE),
                "PriceOracle: oracle price divergence too large"
            );
            return pythPrice;
        }
        return chainlinkPrice.toInt256();
    }
}
