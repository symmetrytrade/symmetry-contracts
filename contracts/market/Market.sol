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
import "hardhat/console.sol";

contract Market is Ownable, Initializable {
    using SafeERC20 for IERC20;
    using SafeDecimalMath for uint256;
    using SignedSafeDecimalMath for int256;
    using SafeCast for uint256;
    using SafeCast for int256;

    // same unit in SafeDeicmalMath and SignedSafeDeicmalMath
    int256 private constant _UNIT = int(10 ** 18);

    // general setting keys
    bytes32 public constant MAINTENANCE_MARGIN_RATIO = "maintenanceMarginRatio";
    bytes32 public constant LIQUIDATION_FEE_RATIO = "liquidationFeeRatio";
    bytes32 public constant LIQUIDATION_PENALTY_RATIO =
        "liquidationPenaltyRatio";
    // setting keys per market
    bytes32 public constant LAMBDA_PREMIUM = "lambdaPremium";
    bytes32 public constant PROPORTION_RATIO = "proportionRatio";
    bytes32 public constant PERP_TRADING_FEE = "perpTradingFee";

    // states
    address public baseToken; // liquidity token
    address public priceOracle; // oracle
    address public perpTracker; // perpetual position tracker
    address public settings; // settings for markets
    mapping(address => bool) public isOperator; // operator contracts

    // liquidity margin (deposited liquidity + realized pnl)
    int256 private liquidityBalance;
    // insurance, collection of liquidation penalty
    uint256 public insuranceBalance;

    event Traded(
        address indexed account,
        address indexed token,
        int256 sizeDelta,
        int256 price,
        uint256 fee
    );

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

            PerpTracker.LpPosition memory position = perpTracker_.getLpPosition(
                token
            );
            if (position.longSize == 0 && position.shortSize == 0) continue;
            int size = position.longSize + position.shortSize;
            int256 price = PriceOracle(priceOracle).getPrice(token, false);
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
                (, int256 nextAccFunding) = perpTracker_.nextAccFunding(
                    token,
                    price
                );
                lpNetValue -= size.multiplyDecimal(
                    nextAccFunding - position.accFunding
                );
            }
            // financing fee
            {
                (
                    int nextAccLongFinancingFee,
                    int nextAccShortFinancingFee
                ) = perpTracker_.nextAccFinancingFee(token, price);
                lpNetValue += (nextAccLongFinancingFee -
                    position.accLongFinancingFee).multiplyDecimal(
                        position.shortSize.abs()
                    );
                lpNetValue += (nextAccShortFinancingFee -
                    position.accShortFinancingFee).multiplyDecimal(
                        position.longSize
                    );
            }
        }
    }

    /**
     * @notice Compute the trading fee of a liquidity redemption. During lp redemption, the exiting lp will trade the position
     * it holds to the lp left in pool.
     * @param lp lp net value in usd
     * @param redeemValue lp to redeem in usd
     */
    function redeemTradingFee(
        address _account,
        int lp,
        int redeemValue
    ) external view returns (uint fee) {
        PerpTracker perpTracker_ = PerpTracker(perpTracker);
        MarketSettings settings_ = MarketSettings(settings);

        uint256 len = perpTracker_.marketTokensLength();
        for (uint i = 0; i < len; ++i) {
            address token = perpTracker_.marketTokensList(i);
            if (!perpTracker_.marketTokensListed(token)) continue;

            int fillPrice;
            int tradeAmount;

            // calculate fill price
            {
                int skew = perpTracker_.currentSkew(token);
                if (skew == 0) continue;
                tradeAmount = skew.multiplyDecimal(redeemValue).divideDecimal(
                    lp
                );
                int price = PriceOracle(priceOracle).getPrice(token, false);
                int lambda = settings_
                    .getUintValsByMarket(
                        perpTracker_.marketKey(token),
                        LAMBDA_PREMIUM
                    )
                    .toInt256();
                int kLP = settings_
                    .getUintValsByMarket(
                        perpTracker_.marketKey(token),
                        PROPORTION_RATIO
                    )
                    .toInt256();
                kLP = kLP.multiplyDecimal(lp - redeemValue);
                fillPrice = perpTracker_.computePerpFillPriceRaw(
                    skew - tradeAmount,
                    tradeAmount,
                    price,
                    kLP,
                    lambda
                );
            }
            // calculate execution price and fee
            (, uint256 tradingFee) = _tradingFee(
                _account,
                token,
                tradeAmount,
                fillPrice
            );
            fee += tradingFee;
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
        PriceOracle oracle_ = PriceOracle(priceOracle);
        uint256 len = perpTracker_.marketTokensLength();
        int pnl = 0;
        for (uint i = 0; i < len; ++i) {
            address token = perpTracker_.marketTokensList(i);
            if (!perpTracker_.marketTokensListed(token)) continue;

            PerpTracker.Position memory position = perpTracker_.getPosition(
                _account,
                token
            );
            if (position.size == 0) continue;

            int256 price = oracle_.getPrice(token, false);
            // update notional value
            positionNotional += position.size.abs().multiplyDecimal(price);
            // update pnl by price
            pnl += position.size.multiplyDecimal(price - position.avgPrice);
            {
                // update pnl by funding fee
                (, int256 nextAccFunding) = perpTracker_.nextAccFunding(
                    token,
                    price
                );
                pnl -= position.size.multiplyDecimal(
                    nextAccFunding - position.accFunding
                );
            }
            // update pnl by financing fee
            {
                (
                    int nextAccLongFinancingFee,
                    int nextAccShortFinancingFee
                ) = perpTracker_.nextAccFinancingFee(token, price);
                pnl -= position.size.abs().multiplyDecimal(
                    position.size > 0
                        ? nextAccLongFinancingFee - position.accFinancingFee
                        : nextAccShortFinancingFee - position.accFinancingFee
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

    /*=== fees ===*/

    /**
     * @dev make sure the oracle price is updated before calling this function
     */
    function _updateFee(address _token) internal {
        int256 price = PriceOracle(priceOracle).getPrice(_token, true);
        PerpTracker(perpTracker).updateFee(_token, price);
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
                    PriceOracle(priceOracle).getPrice(_token, false)
                )
            )
        );
    }

    /**
     * @notice update global data used to calculate funding velocity and financing fee
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
        int256 oraclePrice = PriceOracle(priceOracle).getPrice(_token, true);
        int256 size = perpTracker_.getPositionSize(_account, _token);
        (int lpNetValue, ) = globalStatus();
        return (
            PerpTracker(perpTracker).computePerpFillPrice(
                _token,
                size,
                oraclePrice,
                lpNetValue
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
        int256 oraclePrice = PriceOracle(priceOracle).getPrice(_token, true);
        (int lpNetValue, ) = globalStatus();
        return
            PerpTracker(perpTracker).computePerpFillPrice(
                _token,
                _size,
                oraclePrice,
                lpNetValue
            );
    }

    function _tradingFee(
        address,
        address _token,
        int256 _sizeDelta,
        int256 _price
    ) internal view returns (int256 execPrice, uint256 tradingFee) {
        PerpTracker perpTracker_ = PerpTracker(perpTracker);
        // deduct trading fee in the price
        // (p_{oracle}-p_{avg})*size=(p_{oracle}-p_{fill})*size-p_{avg}*|size|*k%
        // p_{avg}=p_{fill} / (1 - k%) for size > 0
        // p_{avg}=p_{fill} / (1 + k%) for size < 0
        // where k is trading fee ratio
        int256 k = MarketSettings(settings)
            .getUintValsByMarket(
                perpTracker_.marketKey(_token),
                PERP_TRADING_FEE
            )
            .toInt256();
        // TODO: fee discount
        require(k < _UNIT, "Market: trading fee ratio > 1");
        if (_sizeDelta > 0) {
            execPrice = _price.divideDecimal(_UNIT - k);
        } else {
            execPrice = _price.divideDecimal(_UNIT + k);
        }
        tradingFee = execPrice
            .multiplyDecimal(_sizeDelta.abs())
            .multiplyDecimal(k)
            .toUint256();
    }

    /// @notice update a position with a new trade. Will settle p&l if it is a position decreasement.
    /// @dev make sure the funding & financing fee is updated before calling this function.
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

        (int256 execPrice, uint256 tradingFee) = _tradingFee(
            _account,
            _token,
            _sizeDelta,
            _price
        );

        // update user positions
        {
            PerpTracker.Position memory position = perpTracker_.getPosition(
                _account,
                _token
            );
            (int256 nextPrice, int256 pnlAndFunding) = perpTracker_
                .computeTrade(
                    position.size,
                    position.avgPrice,
                    position.accFunding,
                    _sizeDelta,
                    execPrice,
                    latestAccFunding
                );
            // settle p&l and funding
            uint256 tokenAmount = usdToToken(
                baseToken,
                pnlAndFunding.abs(),
                false
            ).toUint256();
            if (pnlAndFunding > 0) {
                perpTracker_.addMargin(_account, tokenAmount);
            } else if (pnlAndFunding < 0) {
                perpTracker_.removeMargin(_account, tokenAmount);
            }
            // settle financing fee
            {
                int openInterestFee;
                {
                    (
                        int nextAccLongFinancingFee,
                        int nextAccShortFinancingFee
                    ) = perpTracker_.latestAccFinancingFee(_token);
                    openInterestFee = position.size.abs().multiplyDecimal(
                        position.size > 0
                            ? nextAccLongFinancingFee - position.accFinancingFee
                            : nextAccShortFinancingFee -
                                position.accFinancingFee
                    );
                }
                if (openInterestFee > 0) {
                    tokenAmount = usdToToken(baseToken, openInterestFee, false)
                        .toUint256();
                    perpTracker_.removeMargin(_account, tokenAmount);
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
            PerpTracker.LpPosition memory position = perpTracker_.getLpPosition(
                _token
            );
            (int256 nextPrice, int256 pnlAndFunding) = perpTracker_
                .computeTrade(
                    position.longSize + position.shortSize,
                    position.avgPrice,
                    position.accFunding,
                    -_sizeDelta, // lp is the counterparty of user
                    execPrice,
                    latestAccFunding
                );
            // settle p&l and funding
            liquidityBalance += usdToToken(baseToken, pnlAndFunding, false);
            // write to state
            perpTracker_.updateLpPosition(_token, -_sizeDelta, nextPrice);
        }

        emit Traded(_account, _token, _sizeDelta, execPrice, tradingFee);
    }

    /*=== pricing ===*/
    function tokenToUsd(
        address _token,
        int256 _amount,
        bool _mustUsePyth
    ) public view returns (int256) {
        return
            (PriceOracle(priceOracle).getPrice(_token, _mustUsePyth) *
                _amount) / int(10 ** IERC20Metadata(_token).decimals());
    }

    function usdToToken(
        address _token,
        int256 _amount,
        bool _mustUsePyth
    ) public view returns (int256) {
        return
            (_amount * int(10 ** IERC20Metadata(_token).decimals())) /
            PriceOracle(priceOracle).getPrice(_token, _mustUsePyth);
    }
}
