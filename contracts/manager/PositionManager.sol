// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../market/Market.sol";
import "../market/MarketSettings.sol";
import "../utils/SafeDecimalMath.sol";
import "../utils/SafeCast.sol";
import "../utils/Initializable.sol";

contract PositionManager is Ownable, Initializable {
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
        uint256 acceptablePrice;
        uint256 expiracy;
        OrderStatus status;
    }

    mapping(uint256 => Order) private orders;
    uint256 public orderCnt;

    event OrderSubmitted(uint256 orderId);

    /*=== initialize ===*/

    function initialize(address _market) external onlyInitializeOnce {
        market = _market;

        _transferOwnership(msg.sender);
    }

    /*=== view ===*/

    function getOrder(uint256 _id) external view returns (Order memory) {
        return orders[_id];
    }

    /*=== margin ===*/

    function depositMargin(uint256 _amount) external {
        Market(market).transferMarginIn(msg.sender, _amount);
    }

    function withdrawMargin(uint256 _amount) external {
        Market market_ = Market(market);
        market_.transferMarginOut(msg.sender, _amount);
        require(
            !isLiquidatable(msg.sender),
            "PositionManager: insufficient margin"
        );
    }

    function isLiquidatable(address _account) public view returns (bool) {
        (int256 maintenanceMargin, int256 currentMargin) = Market(market)
            .accountMarginStatus(_account);
        return maintenanceMargin <= currentMargin;
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
        uint256 _acceptablePrice,
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
        // put order
        ++orderCnt;
        Order memory order = Order({
            account: msg.sender,
            token: _token,
            size: _size,
            acceptablePrice: _acceptablePrice,
            expiracy: _expiracy,
            status: OrderStatus.Pending
        });
        orders[orderCnt] = order;
        // TODO: simulate the order and revert it if needed?
    }

    function _validateOrderLiveness(Order storage order) internal view {
        require(order.account == msg.sender, "PositionManager: invalid sender");
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
        Order storage order = orders[_id];
        _validateOrderLiveness(order);
        order.status = OrderStatus.Cancelled;
    }

    /// @notice execute an submitted execution order, this function is payable for paying the oracle update fee
    /// @param _id order id
    /// @param _priceUpdateData price update data for pyth oracle
    function executeOrder(
        uint256 _id,
        bytes[] calldata _priceUpdateData
    ) external payable {
        Order storage order = orders[_id];
        _validateOrderLiveness(order);

        Market market_ = Market(market);
        // update oracle price
        PriceOracle(market_.priceOracle()).updatePythPrice{value: msg.value}(
            msg.sender,
            _priceUpdateData
        );

        address token = order.token;
        int256 size = order.size;
        // calculate fill price
        int256 fillPrice = market_.computePerpFillPrice(token, size);
        // do trade
        market_.trade(msg.sender, token, size, fillPrice);
        // ensure margin is sufficient after the trade
        require(
            !isLiquidatable(msg.sender),
            "PositionManager: insufficient margin"
        );
        // update order
        order.status = OrderStatus.Executed;
    }

    //TODO: liquidate
}
