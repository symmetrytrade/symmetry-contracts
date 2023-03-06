// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../access/Ownable.sol";
import "../utils/Initializable.sol";
import "../utils/SafeERC20.sol";
import "../utils/SafeDecimalMath.sol";
import "../utils/SafeCast.sol";
import "../interfaces/IERC20.sol";
import "../interfaces/IERC20Metadata.sol";
import "../oracle/PriceOracle.sol";
import "./MarketSettings.sol";
import "./PerpTracker.sol";

contract Market is Ownable, Initializable {
    using SafeERC20 for IERC20;
    using SafeDecimalMath for uint256;
    using SignedSafeDecimalMath for int256;
    using SafeCast for uint256;
    using SafeCast for int256;

    // setting keys
    bytes32 public constant PYTH_MAX_AGE = "pythMaxAge";
    bytes32 public constant MAX_PRICE_DIVERGENCE = "maxPriceDivergence";
    bytes32 public constant MAINTENANCE_MARGIN_RATIO = "maintenanceMarginRatio";

    // states
    address public baseToken; // liquidity token
    address public priceOracle; // oracle
    address public perpTracker; // perpetual position tracker
    address public settings; // settings for markets
    mapping(address => bool) public isOperator; // operator contracts

    // liquidity margin (deposited liquidity + realized pnl)
    int256 public liquidityBalance;

    modifier onlyOperator() {
        require(isOperator[msg.sender], "Market: sender is not operator");
        _;
    }

    /*=== initialize ===*/
    function initialize(
        address _baseToken,
        address _priceOracle,
        address _settings
    ) external onlyInitializeOnce {
        baseToken = _baseToken;
        priceOracle = _priceOracle;
        settings = _settings;

        _transferOwnership(msg.sender);
    }

    /*=== owner functions ===*/

    function setPerpTracker(address _perpTracker) external onlyOwner {
        perpTracker = _perpTracker;
    }

    function setOperator(address _operator, bool _status) external onlyOwner {
        isOperator[_operator] = _status;
    }

    function setOracle(address _priceOracle) external onlyOwner {
        priceOracle = _priceOracle;
    }

    function setSetting(address _settings) external onlyOwner {
        settings = _settings;
    }

    /*=== liquidity ===*/

    /// @notice get the lp funds usage
    /// @return lpNetValue the usd value of assets lp holds(including position p&l)
    /// @return freeLpValue the usd value of lp that can be used for open position
    function getLpStatus()
        public
        view
        returns (int256 lpNetValue, int256 freeLpValue)
    {
        lpNetValue = tokenToUsd(baseToken, liquidityBalance, false);
        int256 positionMargin = 0;

        PerpTracker perpTracker_ = PerpTracker(perpTracker);
        uint256 len = perpTracker_.marketTokensLength();
        for (uint i = 0; i < len; ++i) {
            address token = perpTracker_.marketTokensList(i);
            if (!perpTracker_.marketTokensListed(token)) continue;

            PerpTracker.GlobalPosition memory position = perpTracker_
                .getGlobalPosition(token);
            int size = position.longSize + position.shortSize;
            int256 price = getPrice(token, false);
            if (size != 0) {
                int256 delta = (price - position.avgPrice).multiplyDecimal(
                    size
                );
                int256 absDelta = delta.abs();
                if ((delta < 0 && size < 0) || (delta > 0 && size > 0)) {
                    // user global position is profitable
                    lpNetValue -= absDelta;
                } else {
                    lpNetValue += absDelta;
                }
            }
            positionMargin +=
                (position.longSize + position.shortSize.abs()) *
                price;
        }
        freeLpValue = lpNetValue - positionMargin;
    }

    /*=== perp ===*/

    function transferLiquidityIn(
        address _account,
        uint256 _amount
    ) external onlyOperator {
        IERC20(baseToken).safeTransferFrom(_account, address(this), _amount);
        liquidityBalance += _amount.toInt256();
    }

    function transferLiquidityOut(
        address _account,
        uint256 _amount
    ) external onlyOperator {
        IERC20(baseToken).safeTransfer(_account, _amount);
        liquidityBalance -= _amount.toInt256();
    }

    function transferMarginIn(
        address _account,
        uint256 _amount
    ) external onlyOperator {
        IERC20(baseToken).safeTransferFrom(_account, address(this), _amount);
        PerpTracker(perpTracker).addMargin(_account, _amount);
    }

    function transferMarginOut(
        address _account,
        uint256 _amount
    ) external onlyOperator {
        IERC20(baseToken).safeTransfer(_account, _amount);
        PerpTracker(perpTracker).removeMargin(_account, _amount);
    }

    /// @notice compute the fill price of a trade
    /// @param _token token to trade
    /// @param _size trade size, positive for long, negative for short
    /// @return the fill price
    function computePerpFillPrice(
        address _token,
        int256 _size
    ) external view returns (int256) {
        int256 oraclePrice = getPrice(_token, true);
        return
            PerpTracker(perpTracker).computePerpFillPrice(
                _token,
                _size,
                oraclePrice
            );
    }

    /// @notice get user's margin status
    /// @param _account user address
    /// @return mtm maintenance margin including liquidation fee in usd
    /// @return currentMargin user current margin including position p&l and funding fee in usd
    function accountMarginStatus(
        address _account
    ) external view returns (int256 mtm, int256 currentMargin) {
        PerpTracker perpTracker_ = PerpTracker(perpTracker);
        uint256 len = perpTracker_.marketTokensLength();
        int pnl = 0;
        for (uint i = 0; i < len; ++i) {
            address token = perpTracker_.marketTokensList(i);
            if (!perpTracker_.marketTokensListed(token)) continue;

            PerpTracker.Position memory position = perpTracker_.getPosition(
                _account,
                token
            );
            int256 price = getPrice(position.token, false);
            // update mtm by position size
            // TODO: add liquidation fees
            if (position.size < 0) {
                mtm += (-position.size).multiplyDecimal(price);
            } else {
                mtm += (position.size).multiplyDecimal(price);
            }
            // update pnl by price
            pnl += position.size.multiplyDecimal(price - position.avgPrice);
            // update pnl by funding fee
            // TODO
        }
        mtm = mtm.multiplyDecimal(
            MarketSettings(settings)
                .getUintVals(MAINTENANCE_MARGIN_RATIO)
                .toInt256()
        );
        currentMargin =
            tokenToUsd(baseToken, perpTracker_.userMargin(_account), false) +
            pnl;
    }

    /// @notice update a position with a new trade. Will settle p&l if it is a position decreasement.
    /// @dev make sure the funding rate is updated before calling this function.
    /// @param _account user address
    /// @param _token token to trade
    /// @param _sizeDelta non-zero new trade size, negative for short, positive for long (18 decimals)
    /// @param _price new trade price
    function trade(
        address _account,
        address _token,
        int256 _sizeDelta,
        int256 _price
    ) external onlyOperator {
        PerpTracker perpTracker_ = PerpTracker(perpTracker);
        int256 latestAccFunding = perpTracker_.latestAccFunding(_token);

        // update user positions
        {
            PerpTracker.Position memory position = perpTracker_.getPosition(
                _account,
                _token
            );
            (int256 nextPrice, int256 pnlAndFunding) = _computeTrade(
                position.size,
                position.avgPrice,
                position.accFunding,
                _sizeDelta,
                _price,
                latestAccFunding
            );
            // settle p&l and funding
            uint256 tokenAmount = usdToToken(
                baseToken,
                pnlAndFunding.abs(),
                false
            ).toUint256();
            if (pnlAndFunding > 0) {
                perpTracker_.addMargin(position.account, tokenAmount);
            } else if (pnlAndFunding < 0) {
                perpTracker_.removeMargin(position.account, tokenAmount);
            }
            // write to state
            perpTracker_.updatePosition(
                _account,
                _token,
                position.size + _sizeDelta,
                nextPrice
            );
        }

        // update global positions
        {
            PerpTracker.GlobalPosition memory position = perpTracker_
                .getGlobalPosition(_token);
            (int256 nextPrice, int256 pnlAndFunding) = _computeTrade(
                position.longSize + position.shortSize,
                position.avgPrice,
                position.accFunding,
                _sizeDelta,
                _price,
                latestAccFunding
            );
            // settle p&l and funding
            liquidityBalance += usdToToken(baseToken, pnlAndFunding, false);
            // write to state
            perpTracker_.updateGlobalPosition(_token, _sizeDelta, nextPrice);
        }
    }

    function _computeTrade(
        int256 _size,
        int256 _avgPrice,
        int256 _accFunding,
        int256 _sizeDelta,
        int256 _price,
        int256 _latestAccFunding
    ) internal pure returns (int256 nextPrice, int256 pnlAndFunding) {
        int256 nextSize = _size + _sizeDelta;
        if ((_sizeDelta > 0 && _size >= 0) || (_sizeDelta < 0 && _size <= 0)) {
            // increase position
            nextPrice = ((_size * _avgPrice + _sizeDelta * _price) / nextSize)
                .abs();
        } else {
            // decrease position
            // here _size must be non-zero
            if ((nextSize > 0 && _size > 0) || (nextSize < 0 && _size < 0)) {
                // position direction is not changed
                pnlAndFunding = (_size - nextSize).multiplyDecimal(
                    _price - _avgPrice
                );
                nextPrice = _avgPrice;
            } else {
                // position direction changed
                pnlAndFunding = _size.multiplyDecimal(_price - _avgPrice);
                nextPrice = _price;
            }
        }
        // funding
        pnlAndFunding += (_latestAccFunding - _accFunding).multiplyDecimal(
            _size
        );
    }

    /*=== pricing ===*/
    /// @notice get token's normalized usd price
    /// @param _token token address
    /// @param _usePyth use price from pyth or not
    function getPrice(
        address _token,
        bool _usePyth
    ) public view returns (int256) {
        PriceOracle priceOracle_ = PriceOracle(priceOracle);
        (, uint256 chainlinkPrice) = priceOracle_.getLatestChainlinkPrice(
            _token
        );
        if (_usePyth) {
            MarketSettings settings_ = MarketSettings(settings);
            (, int256 pythPrice) = priceOracle_.getPythPrice(
                _token,
                settings_.getUintVals(PYTH_MAX_AGE)
            );
            uint256 divergence = chainlinkPrice > pythPrice.toUint256()
                ? chainlinkPrice.divideDecimal(pythPrice.toUint256())
                : pythPrice.toUint256().divideDecimal(chainlinkPrice);
            require(
                divergence < settings_.getUintVals(MAX_PRICE_DIVERGENCE),
                "Market: oracle price divergence too large"
            );
            return pythPrice;
        }
        return int256(chainlinkPrice);
    }

    function tokenToUsd(
        address _token,
        int256 _amount,
        bool _usePyth
    ) public view returns (int256) {
        return
            (getPrice(_token, _usePyth) * _amount) /
            int(10 ** IERC20Metadata(_token).decimals());
    }

    function usdToToken(
        address _token,
        int256 _amount,
        bool _usePyth
    ) public view returns (int256) {
        return
            (_amount * int(10 ** IERC20Metadata(_token).decimals())) /
            getPrice(_token, _usePyth);
    }
}
