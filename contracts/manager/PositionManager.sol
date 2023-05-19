// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "../interfaces/IMarket.sol";
import "../interfaces/IMarketSettings.sol";
import "../interfaces/IFeeTracker.sol";
import "../interfaces/IPerpTracker.sol";
import "../interfaces/IPriceOracle.sol";
import "../interfaces/ITradingFeeCoupon.sol";

import "../market/MarketSettingsContext.sol";

import "../utils/CommonContext.sol";
import "../utils/SafeDecimalMath.sol";
import "../utils/Initializable.sol";

contract PositionManager is CommonContext, MarketSettingsContext, Ownable, Initializable {
    using SignedSafeDecimalMath for int;
    using SafeDecimalMath for uint;
    using SafeCast for int;
    using SafeCast for uint;

    // reserved storage slots for base contract upgrade in future
    uint256[50] private __gap;

    // states
    address public market;
    address public coupon;

    enum OrderStatus {
        None,
        Pending,
        Executed,
        Failed,
        Cancelled
    }

    struct Order {
        uint id;
        address account;
        uint index;
        uint submitTime;
        OrderStatus status;
        OrderData data;
    }

    struct OrderData {
        address token;
        int size;
        int acceptablePrice;
        int keeperFee;
        uint expiracy;
        bool reduceOnly;
    }

    mapping(address => uint[]) private userPendingOrders;
    // account => token => sign => size
    mapping(address => mapping(address => mapping(int => int))) public reduceOnlyOrderSize;
    mapping(address => int) public pendingOrderNotional;
    mapping(uint => Order) public orders;
    uint public orderCnt;

    event MarginDeposit(address account, uint amount, bytes32 referral);
    event MarginWithdraw(address account, uint amount);
    event OrderStatusChanged(uint orderId, OrderStatus status);
    event OrderExpiracyChanged(uint orderId, uint expiracy);
    event NewOrder(
        uint orderId,
        address account,
        address token,
        int size,
        int acceptablePrice,
        int keeperFee,
        uint expiracy,
        bool reduceOnly
    );
    // liquidationFee in USD, out amount in base token
    event LiquidationFee(
        address account,
        int notionalLiquidated,
        int liquidationFee,
        uint accountOut,
        uint insuranceOut,
        uint lpOut
    );
    // liquidationPenalty in USD, penaltyAmount in base token
    event LiquidationPenalty(address account, int notionalLiquidated, int liquidationPenalty, uint penaltyAmount);
    // deficitLoss in usd, out amount in base token
    event DeficitLoss(address account, int deficitLoss, uint insuranceOut, uint lpOut);
    event Liquidated(
        address account,
        address token,
        int sizeLiquidated,
        int notionalLiquidated,
        int liquidationFee,
        int liquidationPenalty,
        int deficitLoss,
        uint preMintId
    );

    /*=== initialize ===*/

    function initialize(address _market, address _coupon) external onlyInitializeOnce {
        market = _market;
        coupon = _coupon;

        _transferOwnership(msg.sender);
    }

    /*=== view ===*/

    function getUserOrders(address _account, uint _offset) external view returns (Order[] memory result) {
        uint256 n = _offset + 100 < userPendingOrders[_account].length
            ? _offset + 100
            : userPendingOrders[_account].length;
        if (n > _offset) {
            result = new Order[](n - _offset);
            for (uint256 i = _offset; i < n; ++i) {
                result[i - _offset] = orders[userPendingOrders[_account][i]];
            }
        }
    }

    /*=== margin ===*/

    function depositMargin(uint _amount, bytes32 referral) external {
        IMarket(market).transferMarginIn(msg.sender, _amount);

        emit MarginDeposit(msg.sender, _amount, referral);
    }

    function withdrawMargin(uint _amount) external {
        IMarket market_ = IMarket(market);
        market_.transferMarginOut(msg.sender, _amount);
        // check leverage ratio
        (, int currentMargin, int notional) = IMarket(market).accountMarginStatus(msg.sender);
        notional += pendingOrderNotional[msg.sender];
        require(!_leverageRatioExceeded(currentMargin, notional), "PositionManager: leverage ratio too large");
        // check minimum margin
        if (notional > 0) {
            int minMargin = IMarketSettings(IMarket(market).settings()).getIntVals(MIN_MARGIN);
            require(minMargin < currentMargin, "PositionManager: margin too low");
        }
        emit MarginWithdraw(msg.sender, _amount);
    }

    function isLiquidatable(address _account) public view returns (bool) {
        (int maintenanceMargin, int currentMargin, ) = IMarket(market).accountMarginStatus(_account);
        return maintenanceMargin > currentMargin;
    }

    function _leverageRatioExceeded(int _margin, int _notional) internal view returns (bool) {
        int maxLeverageRatio = IMarketSettings(IMarket(market).settings()).getIntVals(MAX_LEVERAGE_RATIO);
        return _notional / maxLeverageRatio > _margin;
    }

    /*=== position ===*/

    function _validateOrder(address _account, OrderData memory _orderData) internal {
        (, int currentMargin, int notional) = IMarket(market).accountMarginStatus(_account);
        if (_orderData.reduceOnly) {
            // check holding position
            int positionSize = IPerpTracker(IMarket(market).perpTracker()).getPositionSize(_account, _orderData.token);
            int reduceOnlySize = reduceOnlyOrderSize[_account][_orderData.token][_orderData.size.sign()];
            reduceOnlySize += _orderData.size;
            require(
                positionSize.sign() != reduceOnlySize.sign() && positionSize.abs() >= reduceOnlySize.abs(),
                "PositionManager: invalid reduce only order"
            );
            // update reduce only order size
            reduceOnlyOrderSize[_account][_orderData.token][_orderData.size.sign()] = reduceOnlySize;
        } else {
            // check available margin
            int orderNotional = pendingOrderNotional[_account];
            orderNotional += _orderData.size.abs().multiplyDecimal(_orderData.acceptablePrice);
            notional += orderNotional;
            // update pending order notional
            pendingOrderNotional[_account] = orderNotional;
        }
        require(
            !_leverageRatioExceeded(currentMargin - _orderData.keeperFee, notional),
            "PositionManager: leverage ratio too large"
        );
    }

    /**
     * @notice submit an order to the contract.
     */
    function submitOrder(OrderData memory _orderData) external {
        require(_orderData.size != 0, "PositionManager: zero size");
        IMarket market_ = IMarket(market);
        require(
            IPerpTracker(market_.perpTracker()).marketTokensListed(_orderData.token),
            "PositionManager: unlisted token"
        );
        require(_orderData.expiracy > block.timestamp, "PositionManager: invalid expiracy");
        require(
            IMarketSettings(market_.settings()).getIntVals(MIN_KEEPER_FEE) <= _orderData.keeperFee,
            "PositionManager: keeper fee too low"
        );
        _validateOrder(msg.sender, _orderData);
        // deduct keeper fee
        market_.freezeMarginUsd(msg.sender, _orderData.keeperFee);
        // put order
        uint idx = userPendingOrders[msg.sender].length;
        Order memory order = Order({
            id: orderCnt,
            account: msg.sender,
            index: idx,
            submitTime: block.timestamp,
            status: OrderStatus.Pending,
            data: _orderData
        });
        userPendingOrders[msg.sender].push(orderCnt);
        orders[orderCnt++] = order;
        emit NewOrder(
            orderCnt - 1,
            msg.sender,
            _orderData.token,
            _orderData.size,
            _orderData.acceptablePrice,
            _orderData.keeperFee,
            _orderData.expiracy,
            _orderData.reduceOnly
        );
    }

    function submitCancelOrder(uint _id) external {
        require(_id < orderCnt, "PositionManger: invalid order id");
        Order storage order = orders[_id];
        require(order.account == msg.sender, "PositionManager: forbid");
        require(order.status == OrderStatus.Pending, "PositionManager: not pending");
        uint expiracy = block.timestamp +
            IMarketSettings(IMarket(market).settings()).getIntVals(MIN_ORDER_DELAY).toUint256();
        if (expiracy < order.data.expiracy) {
            order.data.expiracy = expiracy;
            emit OrderExpiracyChanged(_id, expiracy);
        } else if (order.data.expiracy < block.timestamp) {
            _cancelOrder(_id);
        }
    }

    function _removeOrder(uint _id) internal {
        Order storage order = orders[_id];
        address account = order.account;
        if (order.data.reduceOnly) {
            // update reduce only order size
            int reduceOnlySize = reduceOnlyOrderSize[account][order.data.token][order.data.size.sign()];
            reduceOnlySize -= order.data.size;
            reduceOnlyOrderSize[account][order.data.token][order.data.size.sign()] = reduceOnlySize;
        } else {
            // update pending order notional
            int orderNotional = pendingOrderNotional[account];
            orderNotional -= order.data.size.abs().multiplyDecimal(order.data.acceptablePrice);
            pendingOrderNotional[account] = orderNotional;
        }
        // remove from user pending orders list
        uint idx = orders[_id].index;
        uint n = userPendingOrders[account].length - 1;
        if (n != idx) {
            uint lastId = userPendingOrders[account][n];
            orders[lastId].index = idx;
            userPendingOrders[account][idx] = userPendingOrders[account][n];
        }
        userPendingOrders[account].pop();
    }

    function _cancelOrder(uint _id) internal {
        Order storage order = orders[_id];
        // send keeper fee
        IMarket(market).unfreezeMargin(order.account, order.data.keeperFee, msg.sender);
        // remove order
        _removeOrder(_id);
        // set status
        order.status = OrderStatus.Cancelled;
        emit OrderStatusChanged(_id, OrderStatus.Cancelled);
    }

    function cancelOrder(uint _id) external {
        require(_id < orderCnt, "PositionManger: invalid order id");
        Order storage order = orders[_id];
        require(order.status == OrderStatus.Pending, "PositionManager: not pending");
        require(order.data.expiracy < block.timestamp, "PositionManager: not expired");
        _cancelOrder(_id);
    }

    function _canExecute(Order memory _order, int _fee) internal view returns (bool) {
        IMarket market_ = IMarket(market);
        (int mtm, int currentMargin, int notional) = market_.accountMarginStatus(_order.account);
        // check liquidation
        if (mtm > currentMargin) {
            return false;
        }
        // post trade check
        IPerpTracker.Position memory oldPosition = IPerpTracker(market_.perpTracker()).getPosition(
            _order.account,
            _order.data.token
        );
        if (_order.data.reduceOnly) {
            if (oldPosition.size.sign() == _order.data.size.sign() || oldPosition.size.abs() < _order.data.size.abs()) {
                return false;
            }
        } else {
            // calculate notional after trade
            int price = IPriceOracle(market_.priceOracle()).getPrice(_order.data.token, false);
            int sizeDiff = (oldPosition.size + _order.data.size).abs() - oldPosition.size.abs();
            notional += sizeDiff.multiplyDecimal(price);
            // check leverage ratio
            if (_leverageRatioExceeded(currentMargin - _fee, notional)) {
                return false;
            }
        }
        return true;
    }

    /// @notice execute an submitted execution order, this function is payable for paying the oracle update fee
    /// @param _id order id
    /// @param _priceUpdateData price update data for pyth oracle
    function executeOrder(uint _id, bytes[] calldata _priceUpdateData) external payable {
        Order memory order = orders[_id];
        require(_id < orderCnt, "PositionManger: invalid order id");
        require(order.status == OrderStatus.Pending, "PositionManager: not pending");
        require(order.data.expiracy >= block.timestamp, "PositionManager: expired");

        IMarket market_ = IMarket(market);
        IPerpTracker perpTracker_ = IPerpTracker(market_.perpTracker());

        require(
            order.submitTime + IMarketSettings(market_.settings()).getIntVals(MIN_ORDER_DELAY).toUint256() <=
                block.timestamp,
            "PositionManager: delay"
        );
        int prevSize = perpTracker_.getPositionSize(order.account, order.data.token);
        int nextSize = prevSize + order.data.size;
        // send keeper fee, remove order
        market_.unfreezeMargin(order.account, order.data.keeperFee, msg.sender);
        _removeOrder(_id);
        // update oracle price
        IPriceOracle(market_.priceOracle()).updatePythPrice{value: msg.value}(_priceUpdateData);
        // update fees
        market_.updateFee(order.data.token);
        {
            // calculate fill price
            (int execPrice, uint fee, uint couponUsed) = market_.computeTrade(
                order.account,
                order.data.token,
                order.data.size
            );
            // check price
            require(
                (execPrice <= order.data.acceptablePrice && order.data.size > 0) ||
                    (execPrice >= order.data.acceptablePrice && order.data.size < 0),
                "PositionManager: unacceptable execution price"
            );
            // check execution
            if (!_canExecute(order, int(fee - couponUsed))) {
                orders[_id].status = OrderStatus.Failed;
                emit OrderStatusChanged(_id, OrderStatus.Failed);
                return;
            }
            // do trade
            market_.trade(order.account, order.data.token, order.data.size, execPrice, fee, couponUsed);
        }
        // update token market info
        {
            (int lpNetValue, int netOpenInterest) = market_.updateTokenInfo(order.data.token);
            (int longSize, int shortSize) = perpTracker_.getNetPositionSize(order.data.token);
            shortSize = shortSize.abs();
            // check single token limit
            int lpLimit = perpTracker_.lpLimitForToken(lpNetValue, order.data.token);
            require(
                (order.data.size < 0 && (lpLimit >= shortSize || shortSize <= longSize)) ||
                    (order.data.size > 0 && (lpLimit >= longSize || longSize <= shortSize)),
                "PositionManager: position size exceeds limit"
            );
            // ensure the order won't make the net open interest larger, if the net open interest exceeds the hardlimit already
            if (netOpenInterest > perpTracker_.lpHardLimit(lpNetValue)) {
                // 1. the order increases the old position and the position side become the overweight side
                // 2. the order decreases the old position entirely and open a new position of counterparty side,
                //    the counterparty side become the overweight side
                if (
                    (prevSize <= 0 && order.data.size < 0 && shortSize > longSize) ||
                    (prevSize >= 0 && order.data.size > 0 && longSize > shortSize) ||
                    (prevSize < 0 && nextSize > 0 && longSize > shortSize) ||
                    (prevSize > 0 && nextSize < 0 && shortSize > longSize)
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
        address _liquidator,
        int _margin,
        int _notionalLiquidated
    ) internal returns (int liquidationFee) {
        IMarket market_ = IMarket(market);
        liquidationFee = IFeeTracker(market_.feeTracker()).liquidationFee(_notionalLiquidated);
        uint accountOut;
        uint lpOut;
        uint insuranceOut;
        if (_margin >= liquidationFee) {
            // margin is sufficient to pay liquidation fee
            accountOut = market_.deductFeeFromAccount(_account, liquidationFee.toUint256(), _liquidator);
        } else if (_margin > 0) {
            // margin is insufficient, deduct fee from user margin, then from insurance, lp
            accountOut = market_.deductFeeFromAccount(_account, _margin.toUint256(), _liquidator);
            (insuranceOut, lpOut) = market_.deductFeeFromInsurance((liquidationFee - _margin).toUint256(), _liquidator);
        } else {
            (insuranceOut, lpOut) = market_.deductFeeFromInsurance(liquidationFee.toUint256(), _liquidator);
        }
        emit LiquidationFee(_account, _notionalLiquidated, liquidationFee, accountOut, insuranceOut, lpOut);
    }

    function _payLiquidationPenalty(
        address _account,
        int _margin,
        int _notionalLiquidated
    ) internal returns (int liquidationPenalty) {
        if (_margin <= 0) return 0;

        IMarket market_ = IMarket(market);
        liquidationPenalty = IFeeTracker(market_.feeTracker()).liquidationPenalty(_notionalLiquidated).min(_margin);
        uint penaltyAmount = market_.deductPenaltyToInsurance(_account, liquidationPenalty.toUint256());
        emit LiquidationPenalty(_account, _notionalLiquidated, liquidationPenalty, penaltyAmount);
    }

    function _preMintCoupon(address _account, int _margin, int _notionalLiquidated) internal returns (uint preMintId) {
        if (_margin <= 0) return 0;

        IMarket market_ = IMarket(market);
        uint value = ((IMarketSettings(market_.settings())
            .getIntVals(LIQUIDATION_COUPON_RATIO)
            .multiplyDecimal(_notionalLiquidated.abs())
            .min(_margin) / _UNIT) * _UNIT).toUint256();
        uint minValue = IMarketSettings(market_.settings()).getIntVals(MIN_COUPON_VALUE).toUint256();
        if (value > 0 && value >= minValue) {
            market_.deductFeeToLiquidity(_account, value);
            return ITradingFeeCoupon(coupon).preMint(_account, value, block.timestamp + 1 weeks);
        }
        return 0;
    }

    function _coverDeficitLoss(address _account, int _deficitLoss) internal {
        (uint insuranceOut, uint lpOut) = IMarket(market).coverDeficitLoss(_account, _deficitLoss);
        emit DeficitLoss(_account, _deficitLoss, insuranceOut, lpOut);
    }

    /**
     * @notice liquidate an account by closing the whole position of a token
     * @param _account account to liquidate
     * @param _token position to liquidate
     * @param _priceUpdateData price update data for pyth oracle
     */
    function liquidatePosition(address _account, address _token, bytes[] calldata _priceUpdateData) external payable {
        IMarket market_ = IMarket(market);
        // update oracle price
        if (_priceUpdateData.length > 0) {
            IPriceOracle(market_.priceOracle()).updatePythPrice{value: msg.value}(_priceUpdateData);
        }
        // update fees
        market_.updateFee(_token);
        // validate liquidation
        require(isLiquidatable(_account), "PositionManager: account is not liquidatable");
        // compute liquidation price
        int size;
        int notionalLiquidated;
        {
            int execPrice;
            uint fee;
            uint couponUsed;
            (size, notionalLiquidated, execPrice, fee, couponUsed) = market_.computeLiquidation(_account, _token);
            // close position
            market_.trade(_account, _token, size, execPrice, fee, couponUsed);
        }
        // post trade margin
        (, int currentMargin, int positionNotional) = market_.accountMarginStatus(_account);
        // fill the exceeding loss from insurance account
        int deficitLoss;
        if (currentMargin < 0 && positionNotional == 0) {
            deficitLoss = -currentMargin;
            _coverDeficitLoss(_account, deficitLoss);
        }
        // deduct liquidation fee to liquidator
        int liquidationFee = _payLiquidationFee(_account, msg.sender, currentMargin, notionalLiquidated);
        // deduct liquidation penalty to insurance account
        int liquidationPenalty = _payLiquidationPenalty(
            _account,
            (currentMargin - liquidationFee).max(0),
            notionalLiquidated
        );
        // pre-mint coupon
        uint preMintId = _preMintCoupon(
            _account,
            (currentMargin - liquidationFee - liquidationPenalty).max(0),
            notionalLiquidated
        );
        // update global info
        market_.updateTokenInfo(_token);

        emit Liquidated(
            _account,
            _token,
            -size,
            notionalLiquidated,
            liquidationFee,
            liquidationPenalty,
            deficitLoss,
            preMintId
        );
    }
}
