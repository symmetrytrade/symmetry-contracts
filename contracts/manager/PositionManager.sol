// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../market/Market.sol";
import "../market/MarketSettings.sol";
import "../utils/SafeDecimalMath.sol";
import "../utils/SafeCast.sol";
import "../utils/Initializable.sol";

contract PositionManager is Ownable, Initializable {
    using SignedSafeDecimalMath for int256;
    using SafeCast for int256;

    // setting keys
    bytes32 public constant MAX_LEVERAGE_RATIO = "maxLeverageRatio";
    bytes32 public constant LIQUIDATION_FEE_RATIO = "liquidationFeeRatio";
    bytes32 public constant LIQUIDATION_PENALTY_RATIO =
        "liquidationPenaltyRatio";

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
            !leverageRatioExceeded(msg.sender),
            "PositionManager: leverage ratio too large"
        );
    }

    function isLiquidatable(address _account) public view returns (bool) {
        (int256 maintenanceMargin, int256 currentMargin, ) = Market(market)
            .accountMarginStatus(_account);
        return maintenanceMargin <= currentMargin;
    }

    function leverageRatioExceeded(
        address _account
    ) public view returns (bool) {
        (, int256 currentMargin, int256 positionNotional) = Market(market)
            .accountMarginStatus(_account);
        int256 maxLeverageRatio = int(
            MarketSettings(Market(market).settings()).getUintVals(
                MAX_LEVERAGE_RATIO
            )
        );
        return
            positionNotional.divideDecimal(maxLeverageRatio) <= currentMargin;
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
        address account = order.account;
        address token = order.token;
        int256 size = order.size;

        Market market_ = Market(market);
        PerpTracker perpTracker_ = PerpTracker(market_.perpTracker());

        // operation type check
        int prevSize = perpTracker_.getPositionSize(account, token);
        // update oracle price
        PriceOracle(market_.priceOracle()).updatePythPrice{value: msg.value}(
            msg.sender,
            _priceUpdateData
        );
        // update fees
        market_.updateFee(token);
        // calculate fill price
        int256 fillPrice = market_.computePerpFillPrice(token, size);
        // do trade
        market_.trade(account, token, size, fillPrice);
        // ensure leverage ratio is higher than max laverage ratio, or is position decrement
        require(
            !leverageRatioExceeded(account) ||
                (prevSize + size).multiplyDecimal(size) <= 0,
            "PositionManager: leverage ratio too large"
        );
        // update token market info
        (int lpNetValue, int netOpenInterest) = market_.updateTokenInfo(token);
        // ensure the order won't make the net open interest larger, if the net open interest exceeds the hardlimit already
        if (netOpenInterest > lpNetValue) {
            (int longSize, int shortSize) = perpTracker_.getGlobalPositionSize(
                token
            );
            // 1. the order increases the old position and the position side become the overweight side
            // 2. the order decreases the old position entirely and open a new position of counterparty side,
            //    the counterparty side become the overweight side
            if (
                (prevSize <= 0 && size < 0 && shortSize > longSize) ||
                (prevSize >= 0 && size > 0 && longSize > shortSize) ||
                (prevSize < 0 && prevSize + size > 0 && longSize > shortSize) ||
                (prevSize > 0 && prevSize + size < 0 && shortSize > longSize)
            ) {
                revert("PositionManager: open interest exceed hardlimit");
            }
        }
        // update order
        order.status = OrderStatus.Executed;
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
        // compute liquidate price
        (int256 liquidationPrice, int256 size) = market_
            .computePerpLiquidatePrice(_account, _token);
        // close position
        market_.trade(_account, _token, size, liquidationPrice);
        // update global info
        market_.updateTokenInfo(_token);
        // post trade margin
        (, int256 currentMargin, ) = market_.accountMarginStatus(_account);
        // deduct liquidation fee to liquidator
        {
            int256 liquidationFeeRatio = int(
                MarketSettings(market_.settings()).getUintVals(
                    LIQUIDATION_FEE_RATIO
                )
            );
            int256 liquidationFee = liquidationPrice
                .multiplyDecimal(size.abs())
                .multiplyDecimal(liquidationFeeRatio);
            if (currentMargin >= liquidationFee) {
                // margin is sufficient to pay liquidation fee
                market_.deductFeeFromAccount(
                    _account,
                    liquidationFee.toUint256(),
                    msg.sender
                );
                currentMargin -= liquidationFee;
            } else {
                // margin is insufficient, deduct fee from user margin, then from insurance, lp
                if (currentMargin > 0) {
                    liquidationFee -= currentMargin;
                    market_.deductFeeFromAccount(
                        _account,
                        currentMargin.toUint256(),
                        msg.sender
                    );
                    currentMargin = 0;
                }
                market_.deductFeeFromInsurance(
                    liquidationFee.toUint256(),
                    msg.sender
                );
            }
        }
        // deduct liquidation penalty to insurance account
        {
            int256 liquidationPenaltyRatio = int(
                MarketSettings(market_.settings()).getUintVals(
                    LIQUIDATION_PENALTY_RATIO
                )
            );
            int256 liquidationPenalty = liquidationPrice
                .multiplyDecimal(size.abs())
                .multiplyDecimal(liquidationPenaltyRatio);
            if (currentMargin >= liquidationPenalty) {
                // margin is sufficient
                market_.deductPenaltyToInsurance(
                    _account,
                    liquidationPenalty.toUint256()
                );
            } else {
                // margin is insufficient, deduct fee from user margin, then from insurance, lp
                if (currentMargin > 0) {
                    liquidationPenalty -= currentMargin;
                    market_.deductPenaltyToInsurance(
                        _account,
                        currentMargin.toUint256()
                    );
                    currentMargin = 0;
                }
            }
        }
        // fill the exceeding loss from insurance account
        if (currentMargin < 0) {
            market_.fillExceedingLoss(_account, uint256(-currentMargin));
        }
    }
}
