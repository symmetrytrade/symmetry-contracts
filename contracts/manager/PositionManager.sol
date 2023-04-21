// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../market/Market.sol";
import "../market/FeeTracker.sol";
import "../market/MarketSettings.sol";
import "../utils/SafeDecimalMath.sol";
import "../utils/SafeCast.sol";
import "../utils/Initializable.sol";

contract PositionManager is Ownable, Initializable {
    using SignedSafeDecimalMath for int256;
    using SafeDecimalMath for uint256;
    using SafeCast for int256;
    using SafeCast for uint256;

    // general setting keys
    bytes32 public constant MAX_LEVERAGE_RATIO = "maxLeverageRatio";
    bytes32 public constant MIN_ORDER_DELAY = "minOrderDelay";
    bytes32 public constant MIN_KEEPER_FEE = "minKeeperFee";
    bytes32 public constant MIN_MARGIN = "minMargin";
    // setting keys per market

    // states
    address public market;

    enum OrderStatus {
        Pending,
        Executed,
        Cancelled
    }

    struct Order {
        address account;
        address token;
        int256 size;
        int256 acceptablePrice;
        uint256 keeperFee;
        uint256 expiracy;
        uint256 submitTime;
        OrderStatus status;
    }

    mapping(uint256 => Order) private orders;
    uint256 public orderCnt;

    event OrderStatusChanged(uint256 orderId, OrderStatus status);
    // liquidationFee in USD, out amount in base token
    event LiquidationFee(
        address account,
        int notionalLiquidated,
        address liquidator,
        int liquidationFee,
        uint accountOut,
        uint insuranceOut,
        uint lpOut
    );
    // liquidationPenalty in USD, penaltyAmount in base token
    event LiquidationPenalty(
        address account,
        int notionalLiquidated,
        address liquidator,
        int liquidationPenalty,
        uint penaltyAmount
    );
    // deficitLoss in usd, out amount in base token
    event DeficitLoss(
        address account,
        int deficitLoss,
        uint insuranceOut,
        uint lpOut
    );
    event Liquidated(
        address account,
        address token,
        int notionalLiquidated,
        address liquidator,
        int liquidationFee,
        int liquidationPenalty,
        int deficitLoss
    );

    /*=== initialize ===*/

    function initialize(address _market) external onlyInitializeOnce {
        market = _market;

        _transferOwnership(msg.sender);
    }

    /*=== owner functions ===*/

    function setMarket(address _market) external onlyOwner {
        market = _market;
    }

    /*=== view ===*/

    function getOrder(uint256 _id) external view returns (Order memory) {
        return orders[_id];
    }

    /*=== margin ===*/

    function depositMargin(uint256 _amount) external {
        Market(market).transferMarginIn(msg.sender, _amount);
        // TODO: min margin balance
    }

    function withdrawMargin(uint256 _amount) external {
        Market market_ = Market(market);
        market_.transferMarginOut(msg.sender, _amount);
        (, int256 currentMargin, int256 positionNotional) = Market(market)
            .accountMarginStatus(msg.sender);
        require(
            !_leverageRatioExceeded(currentMargin, positionNotional),
            "PositionManager: leverage ratio too large"
        );
        if (positionNotional > 0) {
            int256 minMargin = MarketSettings(Market(market).settings())
                .getIntVals(MIN_MARGIN);
            require(
                minMargin < currentMargin,
                "PositionManager: margin too low"
            );
        }
    }

    function isLiquidatable(address _account) public view returns (bool) {
        (int256 maintenanceMargin, int256 currentMargin, ) = Market(market)
            .accountMarginStatus(_account);
        return maintenanceMargin > currentMargin;
    }

    function _leverageRatioExceeded(
        int currentMargin,
        int positionNotional
    ) internal view returns (bool) {
        int256 maxLeverageRatio = MarketSettings(Market(market).settings())
            .getIntVals(MAX_LEVERAGE_RATIO);
        return positionNotional / maxLeverageRatio > currentMargin;
    }

    function leverageRatioExceeded(
        address _account
    ) public view returns (bool) {
        (, int256 currentMargin, int256 positionNotional) = Market(market)
            .accountMarginStatus(_account);
        return _leverageRatioExceeded(currentMargin, positionNotional);
    }

    /*=== position ===*/

    /// @notice submit an order to the contract.
    /// @param _token token to long/short
    /// @param _size position size, negative for short, positive for long (in 18 decimals)
    /// @param _acceptablePrice the worst trade price
    /// @param _expiracy order expiracy
    function submitOrder(
        address _token,
        int256 _size,
        int256 _acceptablePrice,
        uint256 _keeperFee,
        uint256 _expiracy
    ) external {
        require(_size != 0, "PositionManager: zero size");
        Market market_ = Market(market);
        require(
            PerpTracker(market_.perpTracker()).marketTokensListed(_token),
            "PositionManager: unlisted token"
        );
        require(
            _expiracy > block.timestamp,
            "PositionManager: invalid expiracy"
        );
        require(
            MarketSettings(market_.settings())
                .getIntVals(MIN_KEEPER_FEE)
                .toUint256() <= _keeperFee,
            "PositionManager: keeper fee too low"
        );
        // put order
        Order memory order = Order({
            account: msg.sender,
            token: _token,
            size: _size,
            acceptablePrice: _acceptablePrice,
            keeperFee: _keeperFee,
            expiracy: _expiracy,
            submitTime: block.timestamp,
            status: OrderStatus.Pending
        });
        orders[orderCnt++] = order;
        emit OrderStatusChanged(orderCnt - 1, OrderStatus.Pending);
        // TODO: simulate the order and revert it if needed?
    }

    function _validateOrderLiveness(Order memory order) internal view {
        require(
            order.status == OrderStatus.Pending,
            "PositionManager: order is not pending"
        );
        require(
            order.expiracy > block.timestamp,
            "PositionManager: order expired"
        );
    }

    function cancelOrder(uint256 _id) external {
        Order memory order = orders[_id];
        require(order.account == msg.sender, "PositionManager: forbid");
        _validateOrderLiveness(order);
        orders[_id].status = OrderStatus.Cancelled;
        emit OrderStatusChanged(_id, OrderStatus.Cancelled);
    }

    /// @notice execute an submitted execution order, this function is payable for paying the oracle update fee
    /// @param _id order id
    /// @param _priceUpdateData price update data for pyth oracle
    function executeOrder(
        uint256 _id,
        bytes[] calldata _priceUpdateData
    ) external payable {
        Order memory order = orders[_id];
        _validateOrderLiveness(order);

        Market market_ = Market(market);
        PerpTracker perpTracker_ = PerpTracker(market_.perpTracker());

        require(
            order.submitTime +
                MarketSettings(market_.settings())
                    .getIntVals(MIN_ORDER_DELAY)
                    .toUint256() <=
                block.timestamp,
            "PositionManager: delay"
        );
        int prevSize = perpTracker_.getPositionSize(order.account, order.token);
        // update oracle price
        PriceOracle(market_.priceOracle()).updatePythPrice{value: msg.value}(
            msg.sender,
            _priceUpdateData
        );
        // update fees
        market_.updateFee(order.token);
        {
            // calculate fill price
            int256 fillPrice = market_.computePerpFillPrice(
                order.token,
                order.size
            );
            // deduct keeper fee
            if (msg.sender != order.account) {
                market_.deductFeeFromAccount(
                    order.account,
                    order.keeperFee,
                    msg.sender
                );
            }
            // do trade
            int execPrice = market_.trade(
                order.account,
                order.token,
                order.size,
                fillPrice
            );
            require(
                (execPrice <= order.acceptablePrice && order.size > 0) ||
                    (execPrice >= order.acceptablePrice && order.size < 0),
                "PositionManager: unacceptable execution price"
            );
        }
        // ensure leverage ratio is higher than max laverage ratio, or is position decrement
        require(
            !leverageRatioExceeded(order.account) ||
                (prevSize < 0 && order.size > 0 && prevSize + order.size < 0) ||
                (prevSize > 0 && order.size < 0 && prevSize + order.size > 0),
            "PositionManager: leverage ratio too large"
        );
        // update token market info
        {
            (int lpNetValue, int netOpenInterest) = market_.updateTokenInfo(
                order.token
            );
            (int longSize, int shortSize) = perpTracker_.getNetPositionSize(
                order.token
            );
            shortSize = shortSize.abs();
            // check single token limit
            int lpLimit = perpTracker_.lpLimitForToken(lpNetValue, order.token);
            require(
                (order.size < 0 &&
                    (lpLimit >= shortSize || shortSize <= longSize)) ||
                    (order.size > 0 &&
                        (lpLimit >= longSize || longSize <= shortSize)),
                "PositionManager: position size exceeds limit"
            );
            // ensure the order won't make the net open interest larger, if the net open interest exceeds the hardlimit already
            if (netOpenInterest > perpTracker_.lpHardLimit(lpNetValue)) {
                // 1. the order increases the old position and the position side become the overweight side
                // 2. the order decreases the old position entirely and open a new position of counterparty side,
                //    the counterparty side become the overweight side
                if (
                    (prevSize <= 0 && order.size < 0 && shortSize > longSize) ||
                    (prevSize >= 0 && order.size > 0 && longSize > shortSize) ||
                    (prevSize < 0 &&
                        prevSize + order.size > 0 &&
                        longSize > shortSize) ||
                    (prevSize > 0 &&
                        prevSize + order.size < 0 &&
                        shortSize > longSize)
                ) {
                    revert("PositionManager: open interest exceed hardlimit");
                }
            }
        }
        // update order
        orders[_id].status = OrderStatus.Executed;
        emit OrderStatusChanged(_id, OrderStatus.Executed);
    }

    function _payLiquidationFee(
        address _account,
        int _margin,
        int _notionalLiquidated
    ) internal returns (int liquidationFee) {
        Market market_ = Market(market);
        liquidationFee = FeeTracker(market_.feeTracker()).liquidationFee(
            _notionalLiquidated
        );
        uint accountOut;
        uint lpOut;
        uint insuranceOut;
        if (_margin >= liquidationFee) {
            // margin is sufficient to pay liquidation fee
            accountOut = market_.deductFeeFromAccount(
                _account,
                liquidationFee.toUint256(),
                msg.sender
            );
        } else if (_margin > 0) {
            // margin is insufficient, deduct fee from user margin, then from insurance, lp
            accountOut = market_.deductFeeFromAccount(
                _account,
                _margin.toUint256(),
                msg.sender
            );
            (insuranceOut, lpOut) = market_.deductFeeFromInsurance(
                (liquidationFee - _margin).toUint256(),
                msg.sender
            );
        } else {
            (insuranceOut, lpOut) = market_.deductFeeFromInsurance(
                liquidationFee.toUint256(),
                msg.sender
            );
        }
        emit LiquidationFee(
            _account,
            _notionalLiquidated,
            msg.sender,
            liquidationFee,
            accountOut,
            insuranceOut,
            lpOut
        );
    }

    function _payLiquidationPenalty(
        address _account,
        int _margin,
        int _notionalLiquidated
    ) internal returns (int liquidationPenalty) {
        if (_margin <= 0) return 0;

        Market market_ = Market(market);
        liquidationPenalty = FeeTracker(market_.feeTracker())
            .liquidationPenalty(_notionalLiquidated)
            .min(_margin);
        uint penaltyAmount = market_.deductPenaltyToInsurance(
            _account,
            liquidationPenalty.toUint256()
        );
        emit LiquidationPenalty(
            _account,
            _notionalLiquidated,
            msg.sender,
            liquidationPenalty,
            penaltyAmount
        );
    }

    function _coverDeficitLoss(address _account, int _deficitLoss) internal {
        (uint insuranceOut, uint lpOut) = Market(market).coverDeficitLoss(
            _account,
            _deficitLoss
        );
        emit DeficitLoss(_account, _deficitLoss, insuranceOut, lpOut);
    }

    /**
     * @notice liquidate an account by closing the whole position of a token
     * @param _account account to liquidate
     * @param _token position to liquidate
     * @param _priceUpdateData price update data for pyth oracle
     */
    function liquidatePosition(
        address _account,
        address _token,
        bytes[] calldata _priceUpdateData
    ) external payable {
        Market market_ = Market(market);
        // update oracle price
        PriceOracle(market_.priceOracle()).updatePythPrice{value: msg.value}(
            msg.sender,
            _priceUpdateData
        );
        // update fees
        market_.updateFee(_token);
        // validate liquidation
        require(
            isLiquidatable(_account),
            "PositionManager: account is not liquidatable"
        );
        // compute liquidation price
        (
            int256 liquidationPrice,
            int256 size,
            int256 notionalLiquidated
        ) = market_.computePerpLiquidatePrice(_account, _token);
        // close position
        market_.trade(_account, _token, size, liquidationPrice);
        // update global info
        market_.updateTokenInfo(_token);
        // post trade margin
        (, int256 currentMargin, ) = market_.accountMarginStatus(_account);
        // fill the exceeding loss from insurance account
        int deficitLoss;
        if (currentMargin < 0) {
            deficitLoss = -currentMargin;
            _coverDeficitLoss(_account, deficitLoss);
        }
        // deduct liquidation fee to liquidator
        int liquidationFee = _payLiquidationFee(
            _account,
            currentMargin,
            notionalLiquidated
        );
        // deduct liquidation penalty to insurance account
        int liquidationPenalty = _payLiquidationPenalty(
            _account,
            (currentMargin - liquidationFee).max(0),
            notionalLiquidated
        );
        emit Liquidated(
            _account,
            _token,
            notionalLiquidated,
            msg.sender,
            liquidationFee,
            liquidationPenalty,
            deficitLoss
        );
    }
}
