// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../access/Ownable.sol";
import "../utils/Initializable.sol";
import "../utils/SafeERC20.sol";
import "../utils/SafeDecimalMath.sol";
import "../interfaces/IERC20.sol";
import "../interfaces/IERC20Metadata.sol";
import "../oracle/PriceOracle.sol";
import "./MarketSettings.sol";
import "./PerpTracker.sol";

contract Market is Ownable, Initializable {
    using SafeERC20 for IERC20;
    using SafeDecimalMath for uint256;
    using SignedSafeDecimalMath for int256;

    // setting keys
    bytes32 internal constant PYTH_MAX_AGE = "pythMaxAge";
    bytes32 internal constant MAX_PRICE_DIVERGENCE = "maxPriceDivergence";
    bytes32 internal constant MAINTENANCE_MARGIN_RATIO =
        "maintenanceMarginRatio";

    // states
    address public baseToken; // liquidity token
    address public priceOracle; // oracle
    address public perpTracker; // perpetual position tracker
    address public settings; // settings for markets
    mapping(address => bool) public isOperator; // operator contracts

    // deposited liquidity(exclude funding fee & pnl)
    // margin deposited by user is balanceOf(address(this)) - liquidityBalance
    uint256 public liquidityBalance;

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
        lpNetValue = int(tokenToUsd(baseToken, liquidityBalance, false));
        int256 positionMargin = 0;

        PerpTracker perpTracker_ = PerpTracker(perpTracker);
        uint256 len = perpTracker_.marketTokensLength();
        for (uint i = 0; i < len; ++i) {
            address token = perpTracker_.marketTokensList(i);
            if (!perpTracker_.marketTokensListed(token)) continue;

            PerpTracker.GlobalPosition memory position = perpTracker_
                .getGlobalPosition(token);
            int size = position.longSize + position.shortSize;
            int256 price = int(getPrice(token, false));
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
        liquidityBalance += _amount;
    }

    function transferLiquidityOut(
        address _account,
        uint256 _amount
    ) external onlyOperator {
        IERC20(baseToken).safeTransfer(_account, _amount);
        liquidityBalance -= _amount;
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

    /// @notice get user's margin status
    /// @param _account user address
    /// @return mtm maintenance margin including liquidation fee in usd
    /// @return currentMargin user current margin including position p&l and funding fee in usd
    function accountMarginStatus(
        address _account
    ) external view returns (uint256 mtm, int256 currentMargin) {
        PerpTracker perpTracker_ = PerpTracker(perpTracker);
        uint256[] memory positionIds = perpTracker_.getUserPositions(_account);
        uint256 len = positionIds.length;
        int pnl = 0;
        for (uint i = 0; i < len; ++i) {
            PerpTracker.Position memory position = perpTracker_.getPosition(
                positionIds[i]
            );
            uint256 price = getPrice(position.token, false);
            // update mtm by position size
            // TODO: add liquidation fees
            if (position.size < 0) {
                mtm += uint(-position.size).multiplyDecimal(price);
            } else {
                mtm += uint(position.size).multiplyDecimal(price);
            }
            // update pnl by price
            pnl += position.size.multiplyDecimal(
                int(price) - int(position.avgPrice)
            );
            // update pnl by funding fee
            // TODO
        }
        mtm = mtm.multiplyDecimal(
            MarketSettings(settings).getUintVals(MAINTENANCE_MARGIN_RATIO)
        );
        currentMargin =
            int(
                tokenToUsd(baseToken, perpTracker_.userMargin(_account), false)
            ) +
            pnl;
    }

    /// @notice update a position with a new trade. Will settle p&l if it is a position decreasement.
    /// @param _id position id
    /// @param _sizeDelta non-zero new trade size, negative for short, positive for long (18 decimals)
    /// @param _price new trade price
    function updatePosition(
        uint256 _id,
        int256 _sizeDelta,
        uint256 _price
    ) external onlyOperator {
        PerpTracker perpTracker_ = PerpTracker(perpTracker);
        PerpTracker.Position memory position = perpTracker_.getPosition(_id);

        int256 nextSize = position.size + _sizeDelta;
        uint256 nextPrice;
        if (
            (_sizeDelta > 0 && position.size >= 0) ||
            (_sizeDelta < 0 && position.size <= 0)
        ) {
            // increase position
            nextPrice = uint(
                ((position.size *
                    int(position.avgPrice) +
                    _sizeDelta *
                    int(_price)) / nextSize).abs()
            );
        } else {
            // decrease position
            // here position.size must be non-zero
            int256 pnl;
            if (
                (nextSize > 0 && position.size > 0) ||
                (nextSize < 0 && position.size < 0)
            ) {
                // position direction is not changed
                pnl = (postion.size - nextSize).multiplyDecimal(
                    int(_price) - int(position.avgPrice)
                );
                nextPrice = position.avgPrice;
            } else {
                // position direction changed
                pnl = position.size.multiplyDecimal(
                    int(_price) - int(position.avgPrice)
                );
                nextPrice = _price;
            }
            // settle p&l
            uint256 tokenAmount = usdToToken(baseToken, uint(pnl.abs()), false);
            if (pnl > 0) {
                liquidityBalance -= tokenAmount;
                perpTracker_.addMargin(position.account, tokenAmount);
            } else {
                liquidityBalance += tokenAmount;
                perpTracker_.removeMargin(position.account, tokenAmount);
            }
        }
        // write to state
        perpTracker_.updatePosition(_id, nextSize, nextPrice);
    }

    /*=== pricing ===*/
    /// @notice get token's normalized usd price
    /// @param _token token address
    /// @param _usePyth use price from pyth or not
    function getPrice(
        address _token,
        bool _usePyth
    ) public view returns (uint256) {
        PriceOracle priceOracle_ = PriceOracle(priceOracle);
        (, uint256 chainlinkPrice) = priceOracle_.getLatestChainlinkPrice(
            _token
        );
        if (_usePyth) {
            MarketSettings settings_ = MarketSettings(settings);
            (, uint256 pythPrice) = priceOracle_.getPythPrice(
                _token,
                settings_.getUintVals(PYTH_MAX_AGE)
            );
            uint256 divergence = chainlinkPrice > pythPrice
                ? chainlinkPrice.divideDecimal(pythPrice)
                : pythPrice.divideDecimal(chainlinkPrice);
            require(
                divergence < settings_.getUintVals(MAX_PRICE_DIVERGENCE),
                "Market: oracle price divergence too large"
            );
            return pythPrice;
        }
        return chainlinkPrice;
    }

    function tokenToUsd(
        address _token,
        uint256 _amount,
        bool _usePyth
    ) public view returns (uint256) {
        return
            (getPrice(_token, _usePyth) * _amount) /
            (10 ** IERC20Metadata(_token).decimals());
    }

    function usdToToken(
        address _token,
        uint256 _amount,
        bool _usePyth
    ) public view returns (uint256) {
        return
            (_amount * (10 ** IERC20Metadata(_token).decimals())) /
            getPrice(_token, _usePyth);
    }
}
