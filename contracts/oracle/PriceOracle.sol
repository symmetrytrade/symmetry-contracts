// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";

import "../interfaces/IMarketSettings.sol";
import "../interfaces/chainlink/AggregatorV2V3Interface.sol";
import "../interfaces/pyth/IPyth.sol";
import "../interfaces/IPriceOracle.sol";

import "../market/MarketSettingsContext.sol";

import "../utils/Initializable.sol";
import "../utils/SafeDecimalMath.sol";

contract PriceOracle is IPriceOracle, MarketSettingsContext, Ownable, Initializable {
    using SafeCast for int;
    using SafeCast for uint;
    using SafeDecimalMath for uint;

    uint public constant PRICE_PRECISION = 18;

    // chainlink price feed aggregators
    mapping(address => address) public aggregators;
    // chainlink L2 Sequencer Uptime Feeds
    address public sequencerUptimeFeed;
    uint public gracePeriodTime;

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

    function setChainlinkSequencerUptimeFeed(address _sequencerUptimeFeed, uint _gracePeriodTime) public onlyOwner {
        sequencerUptimeFeed = _sequencerUptimeFeed;
        gracePeriodTime = _gracePeriodTime;
    }

    function setChainlinkAggregators(address[] calldata _tokens, address[] calldata _aggregators) external onlyOwner {
        require(_tokens.length == _aggregators.length, "PriceOracle: length not match");
        for (uint i = 0; i < _tokens.length; ++i) aggregators[_tokens[i]] = _aggregators[i];
    }

    function setPythOracle(address _pythOracle) external onlyOwner {
        pythOracle = _pythOracle;
    }

    function setPythIds(address[] calldata _tokens, bytes32[] calldata _ids) external onlyOwner {
        require(_tokens.length == _ids.length, "PriceOracle: length not match");
        for (uint i = 0; i < _tokens.length; ++i) assetIds[_tokens[i]] = _ids[i];
    }

    /*=== price ===*/

    function _checkSequencer() internal view {
        if (sequencerUptimeFeed != address(0)) {
            (, int answer, uint startedAt, , ) = AggregatorV2V3Interface(sequencerUptimeFeed).latestRoundData();
            require(answer == 0, "PriceOracle: Sequencer is down");
            require(block.timestamp - startedAt > gracePeriodTime, "PriceOracle: Grace period not over");
        }
    }

    /// @notice get latest price from chainlink
    /// @param _token token address
    /// @return round id, updatedAt, normalized price
    function getLatestChainlinkPrice(address _token) public view returns (uint80, uint, uint) {
        _checkSequencer();
        AggregatorV2V3Interface aggregator = AggregatorV2V3Interface(aggregators[_token]);
        (uint80 roundID, int price, , uint updatedAt, ) = aggregator.latestRoundData();
        require(price > 0, "PriceOracle: invalid Chainlink price");
        uint normalizedPrice = uint(price);
        uint8 decimals = aggregator.decimals();
        if (decimals > PRICE_PRECISION) {
            normalizedPrice = normalizedPrice / (10 ** (decimals - PRICE_PRECISION));
        } else if (decimals < PRICE_PRECISION) {
            normalizedPrice = normalizedPrice * (10 ** (PRICE_PRECISION - decimals));
        }
        return (roundID, updatedAt, normalizedPrice);
    }

    /**
     * @dev get pyth price updated within a time range
     * @param _token token to query
     * @return success, price publish time, normalized price
     */
    function getPythPrice(address _token) public view returns (uint, int) {
        bytes32 assetId = assetIds[_token];
        require(assetId != bytes32(0), "PriceOracle: undefined pyth asset");
        PythStructs.Price memory price = IPyth(pythOracle).getPriceUnsafe(assetId);
        require(price.price > 0, "PriceOracle: invalid Pyth price");
        int normalizedPrice = int(price.price);
        if (price.expo < -int(PRICE_PRECISION))
            normalizedPrice = normalizedPrice / int(10 ** uint(-price.expo - int(PRICE_PRECISION)));
        else if (price.expo > -int(PRICE_PRECISION))
            normalizedPrice = normalizedPrice * int(10 ** uint(int(PRICE_PRECISION) + price.expo));
        return (price.publishTime, normalizedPrice);
    }

    /// @notice update pyth price, refund remaining fee to sender
    /// @param _sender sender address
    /// @param _priceUpdateData update data for pyth oracle
    function updatePythPrice(address _sender, bytes[] calldata _priceUpdateData) external payable {
        if (_priceUpdateData.length == 0) {
            if (msg.value > 0) {
                payable(_sender).transfer(msg.value);
            }
            return;
        }
        IPyth pythOracle_ = IPyth(pythOracle);

        uint fee = pythOracle_.getUpdateFee(_priceUpdateData);
        require(msg.value >= fee, "PriceOracle: insufficient fee");

        pythOracle_.updatePriceFeeds{value: fee}(_priceUpdateData);
    }

    /// @notice get token's normalized usd price
    /// @param _token token address
    /// @param _mustUsePyth use price from pyth or not
    function getPrice(address _token, bool _mustUsePyth) public view returns (int) {
        IMarketSettings settings_ = IMarketSettings(settings);

        (, uint updatedAt, uint chainlinkPrice) = getLatestChainlinkPrice(_token);
        (uint publishTime, int pythPrice) = getPythPrice(_token);
        require(
            !_mustUsePyth || publishTime + settings_.getIntVals(PYTH_MAX_AGE).toUint256() > block.timestamp,
            "PriceOracle: pyth price too stale"
        );
        if (publishTime > updatedAt) {
            uint divergence = chainlinkPrice > pythPrice.toUint256()
                ? chainlinkPrice.divideDecimal(pythPrice.toUint256())
                : pythPrice.toUint256().divideDecimal(chainlinkPrice);
            require(
                divergence < settings_.getIntVals(MAX_PRICE_DIVERGENCE).toUint256(),
                "PriceOracle: oracle price divergence too large"
            );
            return pythPrice;
        }
        return chainlinkPrice.toInt256();
    }
}
