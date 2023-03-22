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

    // same unit in SafeDeicmalMath and SignedSafeDeicmalMath
    int256 private constant _UNIT = int(10 ** 18);

    // setting keys
    bytes32 public constant PYTH_MAX_AGE = "pythMaxAge";
    bytes32 public constant MAX_PRICE_DIVERGENCE = "maxPriceDivergence";
    bytes32 public constant MAINTENANCE_MARGIN_RATIO = "maintenanceMarginRatio";
    bytes32 public constant MAX_FUNDING_VELOCITY = "maxFundingVelocity";
    bytes32 public constant LIQUIDATION_FEE_RATIO = "liquidationFeeRatio";
    bytes32 public constant LIQUIDATION_PENALTY_RATIO =
        "liquidationPenaltyRatio";
    bytes32 public constant MAX_SOFT_LIMIT = "maxSoftLimit";
    bytes32 public constant SOFT_LIMIT_THRESHOLD = "softLimitThreshold";
    bytes32 public constant MAX_HOLDING_FEE_RATE = "maxHoldingFeeRate";
    bytes32 public constant HOLDING_FEE_BOUND = "holdingFeeBound";

    // states
    address public baseToken; // liquidity token
    address public priceOracle; // oracle
    address public perpTracker; // perpetual position tracker
    address public settings; // settings for markets
    mapping(address => bool) public isOperator; // operator contracts

    // liquidity margin (deposited liquidity + realized pnl)
    int256 public liquidityBalance;
    // insurance, collection of liquidation penalty
    uint256 public insuranceBalance;

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

    /**
     * @notice get the lp net value and open interest of all positions
     * @return lpNetValue the usd value of assets lp holds(including position p&l)
     * @return netOpenInterest the user net open interest
     *     for a token t, OI_{t}= max(Long Open Interest_{t}, abs(Short Open Interest_{t}))
     *     netOpenInterest OI = \sum_{t \in tokens} OI_{t}
     */
    ///
    ///
    function globalStatus()
        public
        view
        returns (int256 lpNetValue, int256 netOpenInterest)
    {
        lpNetValue = tokenToUsd(baseToken, liquidityBalance, false);

        PerpTracker perpTracker_ = PerpTracker(perpTracker);
        uint256 len = perpTracker_.marketTokensLength();
        for (uint i = 0; i < len; ++i) {
            address token = perpTracker_.marketTokensList(i);
            if (!perpTracker_.marketTokensListed(token)) continue;

            PerpTracker.GlobalPosition memory position = perpTracker_
                .getGlobalPosition(token);
            int size = position.longSize + position.shortSize;
            int256 price = getPrice(token, false);
            // open interest, note here position is lp position(counter party of user)
            netOpenInterest += position
                .shortSize
                .abs()
                .max(position.longSize)
                .multiplyDecimal(price);
            // pnl
            lpNetValue += (price - position.avgPrice).multiplyDecimal(size);
            // funding fee
            {
                (, int256 nextAccFunding) = _nextAccFunding(token, price);
                lpNetValue -= size.multiplyDecimal(
                    nextAccFunding - position.accFunding
                );
            }
            // holding fee
            {
                (
                    int nextAccLongHoldingFee,
                    int nextAccShortHoldingFee
                ) = _nextAccHoldingFee(token, price);
                lpNetValue += (nextAccLongHoldingFee -
                    position.accLongHoldingFee).multiplyDecimal(
                        position.shortSize.abs()
                    );
                lpNetValue += (nextAccShortHoldingFee -
                    position.accShortHoldingFee).multiplyDecimal(
                        position.longSize
                    );
            }
        }
    }

    /*=== insurance ===*/

    /**
     * @param _fee fee to pay in usd
     * @param _receiver fee receiver
     */
    function deductFeeFromInsurance(
        uint256 _fee,
        address _receiver
    ) external onlyOperator {
        uint256 amount = usdToToken(baseToken, _fee.toInt256(), false)
            .toUint256();
        IERC20(baseToken).safeTransfer(_receiver, amount);
        if (insuranceBalance >= _fee) {
            insuranceBalance -= _fee;
        } else {
            // if insurance is insufficient, pay rest fee by lp
            _fee -= insuranceBalance;
            insuranceBalance = 0;
            liquidityBalance -= int(_fee);
        }
    }

    function fillExceedingLoss(
        address _account,
        uint256 _loss
    ) external onlyOperator {
        uint256 amount = usdToToken(baseToken, _loss.toInt256(), false)
            .toUint256();
        PerpTracker(perpTracker).addMargin(_account, amount);
        if (insuranceBalance > amount) {
            insuranceBalance -= amount;
        } else {
            amount -= insuranceBalance;
            insuranceBalance = 0;
            liquidityBalance -= int(amount);
        }
    }

    /*=== margin ===*/

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

    /**
     * @param _account account to pay the fee
     * @param _fee fee to pay in usd
     * @param _receiver fee receiver
     */
    function deductFeeFromAccount(
        address _account,
        uint256 _fee,
        address _receiver
    ) external onlyOperator {
        uint256 amount = usdToToken(baseToken, _fee.toInt256(), false)
            .toUint256();
        IERC20(baseToken).safeTransfer(_receiver, amount);
        PerpTracker(perpTracker).removeMargin(_account, amount);
    }

    /**
     * @param _account account to pay the fee
     * @param _fee fee to pay in usd
     */
    function deductPenaltyToInsurance(
        address _account,
        uint256 _fee
    ) external onlyOperator {
        uint256 amount = usdToToken(baseToken, _fee.toInt256(), false)
            .toUint256();
        PerpTracker(perpTracker).removeMargin(_account, amount);
        insuranceBalance += amount;
    }

    /// @notice get user's margin status
    /// @param _account user address
    /// @return mtm maintenance margin including liquidation fee and penalty
    /// @return currentMargin user current margin including position p&l and funding fee in usd
    /// @return positionNotional notional value of all user positions
    function accountMarginStatus(
        address _account
    )
        external
        view
        returns (int256 mtm, int256 currentMargin, int256 positionNotional)
    {
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
            // update notional value
            positionNotional += position.size.abs().multiplyDecimal(price);
            // update pnl by price
            pnl += position.size.multiplyDecimal(price - position.avgPrice);
            {
                // update pnl by funding fee
                (, int256 nextAccFunding) = _nextAccFunding(token, price);
                pnl -= position.size.multiplyDecimal(
                    nextAccFunding - position.accFunding
                );
            }
            // update pnl by holding fee
            {
                (
                    int nextAccLongHoldingFee,
                    int nextAccShortHoldingFee
                ) = _nextAccHoldingFee(token, price);
                pnl -= position.size.abs().multiplyDecimal(
                    position.size > 0
                        ? nextAccLongHoldingFee - position.accHoldingFee
                        : nextAccShortHoldingFee - position.accHoldingFee
                );
            }
        }
        MarketSettings settings_ = MarketSettings(settings);
        mtm = positionNotional.multiplyDecimal(
            (settings_.getUintVals(MAINTENANCE_MARGIN_RATIO) +
                settings_.getUintVals(LIQUIDATION_FEE_RATIO) +
                settings_.getUintVals(LIQUIDATION_PENALTY_RATIO)).toInt256()
        );
        currentMargin =
            tokenToUsd(baseToken, perpTracker_.userMargin(_account), false) +
            pnl;
    }

    /*=== funding & holding fees ===*/

    /**
     * @dev compute funding velocity:
     * v = min{max{-1, skew / L}, 1} * v_max
     * @param _token token address
     */
    function _fundingVelocity(
        address _token
    ) internal view returns (int256 velocity) {
        PerpTracker perpTracker_ = PerpTracker(perpTracker);
        // latest lp net value and skew
        int256 lpNetValue = perpTracker_.latestLpNetValue(_token);
        int skew = perpTracker_.latestSkew(_token);
        // max velocity
        int256 maxVelocity = MarketSettings(settings)
            .getUintValsByMarket(
                perpTracker_.marketKey(_token),
                MAX_FUNDING_VELOCITY
            )
            .toInt256();
        return
            skew
                .divideDecimal(lpNetValue)
                .max(-_UNIT)
                .min(_UNIT)
                .multiplyDecimal(maxVelocity);
    }

    /**
     * @dev compute the current funding rate based on funding velocity
     * @param _token token address
     */
    function _nextFundingRate(
        address _token
    )
        internal
        view
        returns (
            int256 nextFundingRate,
            int256 latestFundingRate,
            int256 timeElapsed
        )
    {
        PerpTracker perpTracker_ = PerpTracker(perpTracker);
        // get latest funding rate
        latestFundingRate = perpTracker_.latestFundingRate(_token);
        // get funding rate velocity
        int256 fundingVelocity = _fundingVelocity(_token);
        // get time epalsed (normalized to days)
        timeElapsed = (int(block.timestamp) -
            perpTracker_.latestFeeUpdateTime(_token)).max(0).divideDecimal(
                1 days
            );
        // next funding rate
        nextFundingRate =
            latestFundingRate +
            fundingVelocity.multiplyDecimal(timeElapsed);
    }

    /**
     * @dev compute next accumulate funding delta
     * @param _token token address
     * @param _price base asset price
     * @return nextAccFunding, accFundingDelta
     */
    function _nextAccFunding(
        address _token,
        int256 _price
    ) internal view returns (int256, int256) {
        PerpTracker perpTracker_ = PerpTracker(perpTracker);
        if (perpTracker_.latestFeeUpdateTime(_token) >= int(block.timestamp)) {
            return (
                perpTracker_.latestFundingRate(_token),
                perpTracker_.latestAccFunding(_token)
            );
        }
        // compute next funding rate
        (
            int nextFundingRate,
            int256 latestFundingRate,
            int256 timeElapsed
        ) = _nextFundingRate(_token);
        int accFundingDelta = ((nextFundingRate + latestFundingRate) / 2)
            .multiplyDecimal(timeElapsed)
            .multiplyDecimal(_price);
        int nextAccFunding = perpTracker_.latestAccFunding(_token) +
            accFundingDelta;
        return (nextFundingRate, nextAccFunding);
    }

    /**
     * @dev get current soft limit, if open interest > soft limit, holding fee will be charged
     *      soft_limit = min(lp_net_value * threshold, max_soft_limit)
     */
    function _getHoldingFeeSoftLimit(
        address _token
    ) internal view returns (int) {
        int lpNetValue = PerpTracker(perpTracker).latestLpNetValue(_token);
        int maxSoftLimit = MarketSettings(settings)
            .getUintVals(MAX_SOFT_LIMIT)
            .toInt256();
        int threshold = MarketSettings(settings)
            .getUintVals(SOFT_LIMIT_THRESHOLD)
            .toInt256();
        return lpNetValue.multiplyDecimal(threshold).min(maxSoftLimit);
    }

    function _nextAccHoldingFee(
        address _token,
        int256 _price
    )
        internal
        view
        returns (int nextAccLongHoldingFee, int nextAccShortHoldingFee)
    {
        PerpTracker perpTracker_ = PerpTracker(perpTracker);
        (nextAccLongHoldingFee, nextAccShortHoldingFee) = perpTracker_
            .latestAccHoldingFee(_token);
        // check soft limit
        if (
            perpTracker_.latestNetOpenInterest(_token) >
            _getHoldingFeeSoftLimit(_token)
        ) {
            (int longSize, int shortSize) = perpTracker_.getGlobalPositionSize(
                _token
            );
            {
                int divergence = longSize > -shortSize
                    ? longSize.divideDecimal(-shortSize)
                    : (-shortSize).divideDecimal(longSize);
                if (
                    divergence <=
                    int(MarketSettings(settings).getUintVals(HOLDING_FEE_BOUND))
                ) return (nextAccLongHoldingFee, nextAccShortHoldingFee);
            }
            // not balance, charge fee from the larger side
            int feeDelta = 0;
            {
                int256 timeElapsed = (int(block.timestamp) -
                    perpTracker_.latestFeeUpdateTime(_token))
                    .max(0)
                    .divideDecimal(1 days);
                // fee rate = min(|skew| / lp_net_value, 1) * max_fee_rate
                int256 lpNetValue = perpTracker_.latestLpNetValue(_token);
                int skew = perpTracker_.latestSkew(_token);
                int256 maxFeeRate = MarketSettings(settings)
                    .getUintVals(MAX_HOLDING_FEE_RATE)
                    .toInt256();
                int256 feeRate = skew
                    .abs()
                    .divideDecimal(lpNetValue)
                    .min(_UNIT)
                    .multiplyDecimal(maxFeeRate);
                feeDelta = feeRate.multiplyDecimal(timeElapsed).multiplyDecimal(
                    _price
                );
            }
            if (feeDelta > 0) {
                if (longSize > -shortSize) {
                    nextAccLongHoldingFee += feeDelta;
                } else {
                    nextAccShortHoldingFee += feeDelta;
                }
            }
        }
    }

    function _updateTokenInfo(
        address _token
    ) internal returns (int lpNetValue, int netOpenInterest) {
        PerpTracker perpTracker_ = PerpTracker(perpTracker);

        (lpNetValue, netOpenInterest) = globalStatus();
        perpTracker_.updateTokenInfo(
            _token,
            PerpTracker.TokenInfo(
                lpNetValue,
                netOpenInterest,
                perpTracker_.currentSkew(_token).multiplyDecimal(
                    getPrice(_token, false)
                )
            )
        );
    }

    /**
     * @dev make sure the oracle price is updated before calling this function
     */
    function _updateFee(address _token) internal {
        int256 price = getPrice(_token, true);
        // get latest funding rate and accumulate funding delta
        (int nextFundingRate, int nextAccFunding) = _nextAccFunding(
            _token,
            price
        );
        (
            int nextAccLongHoldingFee,
            int nextAccShortHoldingFee
        ) = _nextAccHoldingFee(_token, price);
        PerpTracker(perpTracker).updateFee(
            _token,
            PerpTracker.FeeInfo(
                nextAccFunding,
                nextFundingRate,
                nextAccLongHoldingFee,
                nextAccShortHoldingFee,
                int(block.timestamp)
            )
        );
    }

    /**
     * @notice update funding rate, funding fee, only operator role
     * @dev ensure the oracle price is updated before calling this function
     *      update the global market data by updateTokenInfo after current position modification / liquidation
     * @param _token token address
     */
    function updateFee(address _token) external onlyOperator {
        _updateFee(_token);
    }

    /**
     * @notice update global data used to calculate funding velocity and holding fee
     * @dev this function should be called after every position modification / liquidation
     * @param _token token address
     * @return lp net value, net open interest
     */
    function updateTokenInfo(
        address _token
    ) external onlyOperator returns (int, int) {
        return _updateTokenInfo(_token);
    }

    /**
     * @notice public function to update accFunding, funding rate and TokenInfo
     * @param _token token address
     * @param _priceUpdateData price update data
     */
    function updateInfoWithPrice(
        address _token,
        bytes[] calldata _priceUpdateData
    ) external payable {
        // update oracle price
        PriceOracle(priceOracle).updatePythPrice{value: msg.value}(
            msg.sender,
            _priceUpdateData
        );
        _updateFee(_token);
        _updateTokenInfo(_token);
    }

    /*=== liquidation ===*/
    /**
     * @notice compute the fill price of liquidation
     * @param _account account to liquidate
     * @param _token token to liquidate
     * @return liquidation price, liquidation size
     */
    function computePerpLiquidatePrice(
        address _account,
        address _token
    ) external view returns (int256, int256) {
        PerpTracker perpTracker_ = PerpTracker(perpTracker);
        int256 oraclePrice = getPrice(_token, true);
        int256 size = perpTracker_.getPositionSize(_account, _token);
        return (
            PerpTracker(perpTracker).computePerpFillPrice(
                _token,
                size,
                oraclePrice
            ),
            size
        );
    }

    /*=== trade ===*/

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

    /// @notice update a position with a new trade. Will settle p&l if it is a position decreasement.
    /// @dev make sure the funding & holding fee is updated before calling this function.
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
            // settle holding fee
            {
                (
                    int nextAccLongHoldingFee,
                    int nextAccShortHoldingFee
                ) = perpTracker_.latestAccHoldingFee(_token);
                int openInterestFee = position.size.abs().multiplyDecimal(
                    position.size > 0
                        ? nextAccLongHoldingFee - position.accHoldingFee
                        : nextAccShortHoldingFee - position.accHoldingFee
                );
                if (openInterestFee > 0) {
                    tokenAmount = usdToToken(baseToken, openInterestFee, false)
                        .toUint256();
                    perpTracker_.removeMargin(position.account, tokenAmount);
                    liquidityBalance += int(tokenAmount);
                }
            }
            // write to state
            perpTracker_.updatePosition(
                _account,
                _token,
                position.size + _sizeDelta,
                nextPrice
            );
        }

        // update lp global positions
        {
            PerpTracker.GlobalPosition memory position = perpTracker_
                .getGlobalPosition(_token);
            (int256 nextPrice, int256 pnlAndFunding) = _computeTrade(
                position.longSize + position.shortSize,
                position.avgPrice,
                position.accFunding,
                -_sizeDelta, // lp is the counterparty of user
                _price,
                latestAccFunding
            );
            // settle p&l and funding
            liquidityBalance += usdToToken(baseToken, pnlAndFunding, false);
            // write to state
            perpTracker_.updateGlobalPosition(_token, -_sizeDelta, nextPrice);
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
        pnlAndFunding -= (_latestAccFunding - _accFunding).multiplyDecimal(
            _size
        );
    }

    /*=== pricing ===*/
    /// @notice get token's normalized usd price
    /// @param _token token address
    /// @param _mustUsePyth use price from pyth or not
    function getPrice(
        address _token,
        bool _mustUsePyth
    ) public view returns (int256) {
        PriceOracle priceOracle_ = PriceOracle(priceOracle);
        (, uint256 updatedAt, uint256 chainlinkPrice) = priceOracle_
            .getLatestChainlinkPrice(_token);
        MarketSettings settings_ = MarketSettings(settings);
        (uint256 publishTime, int256 pythPrice) = priceOracle_.getPythPrice(
            _token
        );
        require(
            !_mustUsePyth ||
                publishTime + settings_.getUintVals(PYTH_MAX_AGE) >
                block.timestamp,
            "Market: pyth price too stale"
        );
        if (publishTime > updatedAt) {
            uint256 divergence = chainlinkPrice > pythPrice.toUint256()
                ? chainlinkPrice.divideDecimal(pythPrice.toUint256())
                : pythPrice.toUint256().divideDecimal(chainlinkPrice);
            require(
                divergence < settings_.getUintVals(MAX_PRICE_DIVERGENCE),
                "Market: oracle price divergence too large"
            );
            return pythPrice;
        }
        return chainlinkPrice.toInt256();
    }

    function tokenToUsd(
        address _token,
        int256 _amount,
        bool _mustUsePyth
    ) public view returns (int256) {
        return
            (getPrice(_token, _mustUsePyth) * _amount) /
            int(10 ** IERC20Metadata(_token).decimals());
    }

    function usdToToken(
        address _token,
        int256 _amount,
        bool _mustUsePyth
    ) public view returns (int256) {
        return
            (_amount * int(10 ** IERC20Metadata(_token).decimals())) /
            getPrice(_token, _mustUsePyth);
    }
}
