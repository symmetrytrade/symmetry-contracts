// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "../utils/CommonContext.sol";
import "../utils/Initializable.sol";
import "../utils/SafeDecimalMath.sol";

import "../interfaces/IMarket.sol";
import "../interfaces/IMarketSettings.sol";
import "../interfaces/IFeeTracker.sol";
import "../interfaces/IPerpTracker.sol";
import "../interfaces/IPriceOracle.sol";

import "./VolumeTracker.sol";
import "./MarketSettingsContext.sol";

contract Market is IMarket, CommonContext, MarketSettingsContext, Ownable, Initializable {
    using SafeERC20 for IERC20;
    using SafeDecimalMath for uint;
    using SignedSafeDecimalMath for int;
    using SafeCast for uint;
    using SafeCast for int;

    // states
    address public baseToken; // liquidity token
    address public priceOracle; // oracle
    address public perpTracker; // perpetual position tracker
    address public feeTracker; // fee tracker
    address public volumeTracker; // volume tracker
    address public settings; // settings for markets
    mapping(address => bool) public isOperator; // operator contracts

    // liquidity margin (deposited liquidity + realized pnl)
    int private liquidityBalance;
    // insurance, collection of liquidation penalty
    uint public insuranceBalance;

    modifier onlyOperator() {
        require(isOperator[msg.sender], "Market: sender is not operator");
        _;
    }

    /*=== initialize ===*/
    function initialize(address _baseToken, address _priceOracle, address _settings) external onlyInitializeOnce {
        baseToken = _baseToken;
        priceOracle = _priceOracle;
        settings = _settings;

        _transferOwnership(msg.sender);
    }

    /*=== owner functions ===*/

    function setPerpTracker(address _perpTracker) external onlyOwner {
        perpTracker = _perpTracker;
    }

    function setFeeTracker(address _feeTracker) external onlyOwner {
        feeTracker = _feeTracker;
    }

    function setVolumeTracker(address _volumeTracker) external onlyOwner {
        volumeTracker = _volumeTracker;
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

    function _transferLiquidityIn(address _account, uint _amount) internal {
        IERC20(baseToken).safeTransferFrom(_account, address(this), _amount);
        liquidityBalance += _amount.toInt256();
    }

    function transferLiquidityIn(address _account, uint _amount) external onlyOperator {
        _transferLiquidityIn(_account, _amount);
    }

    function _transferLiquidityOut(address _account, uint _amount) internal {
        IERC20(baseToken).safeTransfer(_account, _amount);
        liquidityBalance -= _amount.toInt256();
    }

    function transferLiquidityOut(address _account, uint _amount) external onlyOperator {
        _transferLiquidityOut(_account, _amount);
    }

    /**
     * @notice get the lp net value and open interest of all positions
     * @return lpNetValue the usd value of assets lp holds(including position p&l)
     * @return netOpenInterest the user net open interest
     *     for a token t, OI_{t}= max(Long Open Interest_{t}, abs(Short Open Interest_{t}))
     *     netOpenInterest OI = \sum_{t \in tokens} OI_{t}
     */
    function globalStatus() public view returns (int lpNetValue, int netOpenInterest) {
        lpNetValue = tokenToUsd(baseToken, liquidityBalance, false);

        IPerpTracker perpTracker_ = IPerpTracker(perpTracker);
        uint len = perpTracker_.marketTokensLength();
        for (uint i = 0; i < len; ++i) {
            address token = perpTracker_.marketTokensList(i);
            if (!perpTracker_.marketTokensListed(token)) continue;

            IPerpTracker.LpPosition memory position = perpTracker_.getLpPosition(token);
            if (position.longSize == 0 && position.shortSize == 0) continue;
            int size = position.longSize + position.shortSize;
            int price = IPriceOracle(priceOracle).getPrice(token, false);
            // open interest, note here position is lp position(counter party of user)
            netOpenInterest += position.shortSize.abs().max(position.longSize).multiplyDecimal(price);
            // pnl
            lpNetValue += (price - position.avgPrice).multiplyDecimal(size);
            // funding fee
            {
                (, int nextAccFunding) = perpTracker_.nextAccFunding(token, price);
                lpNetValue -= size.multiplyDecimal(nextAccFunding - position.accFunding);
            }
            // financing fee
            {
                (int nextAccLongFinancingFee, int nextAccShortFinancingFee) = perpTracker_.nextAccFinancingFee(
                    token,
                    price
                );
                lpNetValue += (nextAccLongFinancingFee - position.accLongFinancingFee).multiplyDecimal(
                    position.shortSize.abs()
                );
                lpNetValue += (nextAccShortFinancingFee - position.accShortFinancingFee).multiplyDecimal(
                    position.longSize
                );
            }
        }
    }

    /*=== insurance ===*/

    function _deductInsuranceAndLp(uint amount) internal returns (uint insuranceOut, uint lpOut) {
        if (insuranceBalance >= amount) {
            insuranceOut = amount;
            insuranceBalance -= amount;
        } else {
            // if insurance is insufficient, pay rest fee by lp
            insuranceOut = insuranceBalance;
            lpOut = amount - insuranceBalance;

            insuranceBalance = 0;
            liquidityBalance -= int(lpOut);
        }
    }

    /**
     * @param _fee fee to pay in usd
     * @param _receiver fee receiver
     */
    function deductFeeFromInsurance(
        uint _fee,
        address _receiver
    ) external onlyOperator returns (uint insuranceOut, uint lpOut) {
        uint amount = usdToToken(baseToken, _fee.toInt256(), false).toUint256();
        IERC20(baseToken).safeTransfer(_receiver, amount);
        return _deductInsuranceAndLp(amount);
    }

    function coverDeficitLoss(
        address _account,
        int _loss
    ) external onlyOperator returns (uint insuranceOut, uint lpOut) {
        uint amount = usdToToken(baseToken, _loss, false).toUint256();
        IPerpTracker(perpTracker).addMargin(_account, amount);
        return _deductInsuranceAndLp(amount);
    }

    /*=== margin ===*/

    function transferMarginIn(address _account, uint _amount) external onlyOperator {
        IERC20(baseToken).safeTransferFrom(_account, address(this), _amount);
        IPerpTracker(perpTracker).addMargin(_account, _amount);
    }

    function transferMarginOut(address _account, uint _amount) external onlyOperator {
        IERC20(baseToken).safeTransfer(_account, _amount);
        IPerpTracker(perpTracker).removeMargin(_account, _amount);
    }

    /**
     * @param _account account to pay the fee
     * @param _fee fee to pay in usd
     * @param _receiver fee receiver
     */
    function deductFeeFromAccount(
        address _account,
        uint _fee,
        address _receiver
    ) external onlyOperator returns (uint amount) {
        amount = usdToToken(baseToken, _fee.toInt256(), false).toUint256();
        IERC20(baseToken).safeTransfer(_receiver, amount);
        IPerpTracker(perpTracker).removeMargin(_account, amount);
    }

    /**
     * @param _account account to pay the fee
     * @param _fee fee to pay in usd
     */
    function deductPenaltyToInsurance(address _account, uint _fee) external onlyOperator returns (uint amount) {
        amount = usdToToken(baseToken, _fee.toInt256(), false).toUint256();
        IPerpTracker(perpTracker).removeMargin(_account, amount);
        insuranceBalance += amount;
    }

    /**
     * @param _account account to pay the fee
     * @param _fee fee to pay in usd
     */
    function deductFeeToLiquidity(address _account, uint _fee) external onlyOperator returns (uint amount) {
        amount = usdToToken(baseToken, _fee.toInt256(), false).toUint256();
        IPerpTracker(perpTracker).removeMargin(_account, amount);
        liquidityBalance += int(amount);
    }

    /// @notice get user's margin status
    /// @param _account user address
    /// @return mtm maintenance margin including liquidation fee and penalty
    /// @return currentMargin user current margin including position p&l and funding fee in usd
    /// @return positionNotional notional value of all user positions
    function accountMarginStatus(
        address _account
    ) external view returns (int mtm, int currentMargin, int positionNotional) {
        IPerpTracker perpTracker_ = IPerpTracker(perpTracker);
        IPriceOracle oracle_ = IPriceOracle(priceOracle);
        uint len = perpTracker_.marketTokensLength();
        int pnl = 0;
        int mtmRatio;
        int feeRatio;
        int minFee;
        {
            IMarketSettings settings_ = IMarketSettings(settings);
            mtmRatio = settings_.getIntVals(MAINTENANCE_MARGIN_RATIO);
            feeRatio = settings_.getIntVals(LIQUIDATION_FEE_RATIO);
            minFee = settings_.getIntVals(MIN_LIQUIDATION_FEE);
        }
        for (uint i = 0; i < len; ++i) {
            address token = perpTracker_.marketTokensList(i);
            if (!perpTracker_.marketTokensListed(token)) continue;

            IPerpTracker.Position memory position = perpTracker_.getPosition(_account, token);
            if (position.size == 0) continue;

            int price = oracle_.getPrice(token, false);
            // update notional value & mtm
            {
                int notional = position.size.abs().multiplyDecimal(price);
                positionNotional += notional;
                mtm += notional.multiplyDecimal(mtmRatio - feeRatio) + notional.multiplyDecimal(feeRatio).max(minFee);
            }
            // update pnl by price
            pnl += position.size.multiplyDecimal(price - position.avgPrice);
            {
                // update pnl by funding fee
                (, int nextAccFunding) = perpTracker_.nextAccFunding(token, price);
                pnl -= position.size.multiplyDecimal(nextAccFunding - position.accFunding);
            }
            // update pnl by financing fee
            {
                (int nextAccLongFinancingFee, int nextAccShortFinancingFee) = perpTracker_.nextAccFinancingFee(
                    token,
                    price
                );
                pnl -= position.size.abs().multiplyDecimal(
                    position.size > 0
                        ? nextAccLongFinancingFee - position.accFinancingFee
                        : nextAccShortFinancingFee - position.accFinancingFee
                );
            }
            // update mtm
        }
        currentMargin = tokenToUsd(baseToken, perpTracker_.userMargin(_account), false) + pnl;
    }

    /*=== fees ===*/

    /**
     * @dev make sure the oracle price is updated before calling this function
     */
    function _updateFee(address _token) internal {
        int price = IPriceOracle(priceOracle).getPrice(_token, true);
        IPerpTracker(perpTracker).updateFee(_token, price);
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

    function _updateTokenInfo(address _token) internal returns (int lpNetValue, int netOpenInterest) {
        IPerpTracker perpTracker_ = IPerpTracker(perpTracker);

        (lpNetValue, netOpenInterest) = globalStatus();
        perpTracker_.updateTokenInfo(
            _token,
            IPerpTracker.TokenInfo(
                lpNetValue,
                netOpenInterest,
                perpTracker_.currentSkew(_token).multiplyDecimal(IPriceOracle(priceOracle).getPrice(_token, false))
            )
        );
    }

    /**
     * @notice update global data used to calculate funding velocity and financing fee
     * @dev this function should be called after every position modification / liquidation
     * @param _token token address
     * @return lp net value, net open interest
     */
    function updateTokenInfo(address _token) external onlyOperator returns (int, int) {
        return _updateTokenInfo(_token);
    }

    /**
     * @notice public function to update accFunding, funding rate and TokenInfo
     * @param _token token address
     * @param _priceUpdateData price update data
     */
    function updateInfoWithPrice(address _token, bytes[] calldata _priceUpdateData) external payable {
        // update oracle price
        IPriceOracle(priceOracle).updatePythPrice{value: msg.value}(msg.sender, _priceUpdateData);
        _updateFee(_token);
        _updateTokenInfo(_token);
    }

    function redeemTradingFee(address _account, int _lp, int _redeemValue) external onlyOperator returns (uint fee) {
        fee = IFeeTracker(feeTracker).redeemTradingFee(_account, _lp, _redeemValue);
    }

    /*=== liquidation ===*/
    /**
     * @notice compute the fill price of liquidation
     * @param _account account to liquidate
     * @param _token token to liquidate
     * @return liquidation price, liquidation notional
     */
    function computePerpLiquidatePrice(address _account, address _token) external view returns (int, int, int) {
        IPerpTracker perpTracker_ = IPerpTracker(perpTracker);
        int oraclePrice = IPriceOracle(priceOracle).getPrice(_token, true);
        int size = -perpTracker_.getPositionSize(_account, _token);
        (int lpNetValue, ) = globalStatus();
        return (
            IPerpTracker(perpTracker).computePerpFillPrice(_token, size, oraclePrice, lpNetValue),
            size,
            size.multiplyDecimal(oraclePrice).abs()
        );
    }

    /*=== trade ===*/

    /// @notice compute the fill price of a trade
    /// @param _token token to trade
    /// @param _size trade size, positive for long, negative for short
    /// @return the fill price
    function computePerpFillPrice(address _token, int _size) external view returns (int) {
        int oraclePrice = IPriceOracle(priceOracle).getPrice(_token, true);
        (int lpNetValue, ) = globalStatus();
        return IPerpTracker(perpTracker).computePerpFillPrice(_token, _size, oraclePrice, lpNetValue);
    }

    function _logTrade(address _account, uint _volume, uint _fee) internal {
        // veSYM incentives
        uint amountToDistribute = tokenToUsd(baseToken, int(_fee), false)
            .multiplyDecimal(IMarketSettings(settings).getIntVals(VESYM_FEE_INCENTIVE_RATIO))
            .toUint256();
        _transferLiquidityOut(feeTracker, amountToDistribute);
        IFeeTracker(feeTracker).distributeIncentives(amountToDistribute);
        // Volume
        VolumeTracker(volumeTracker).logTrade(_account, _volume);
    }

    /// @notice update a position with a new trade. Will settle p&l if it is a position decreasement.
    /// @dev make sure the funding & financing fee is updated before calling this function.
    /// @param _account user address
    /// @param _token token to trade
    /// @param _sizeDelta non-zero new trade size, negative for short, positive for long (18 decimals)
    /// @param _price new trade price
    function trade(address _account, address _token, int _sizeDelta, int _price) external onlyOperator returns (int) {
        IPerpTracker perpTracker_ = IPerpTracker(perpTracker);

        require(perpTracker_.latestUpdated(_token) == block.timestamp, "Market: fee is not updated");

        (int execPrice, uint tradingFee, uint couponUsed) = IFeeTracker(feeTracker).discountedTradingFee(
            _account,
            _sizeDelta,
            _price
        );
        _logTrade(_account, _sizeDelta.multiplyDecimal(_price).abs().toUint256(), tradingFee);

        // funding fee
        perpTracker_.settleFunding(_account, _token);
        liquidityBalance += usdToToken(baseToken, perpTracker_.computeLpFunding(_token), false);
        // financing fee
        {
            int financingFee = perpTracker_.computeFinancingFee(_account, _token);
            if (financingFee > 0) {
                uint tokenAmount = usdToToken(baseToken, financingFee, false).toUint256();
                perpTracker_.removeMargin(_account, tokenAmount);
                liquidityBalance += int(tokenAmount);
            }
        }
        // trade
        {
            (int oldSize, int newSize) = perpTracker_.settleTradeForUser(_account, _token, _sizeDelta, execPrice);
            liquidityBalance += usdToToken(
                baseToken,
                perpTracker_.settleTradeForLp(_token, -_sizeDelta, execPrice, oldSize, newSize),
                false
            );
        }

        emit Traded(_account, _token, _sizeDelta, execPrice, tradingFee, couponUsed);
        return execPrice;
    }

    /*=== pricing ===*/
    function tokenToUsd(address _token, int _amount, bool _mustUsePyth) public view returns (int) {
        return
            (IPriceOracle(priceOracle).getPrice(_token, _mustUsePyth) * _amount) /
            int(10 ** IERC20Metadata(_token).decimals());
    }

    function usdToToken(address _token, int _amount, bool _mustUsePyth) public view returns (int) {
        return
            (_amount * int(10 ** IERC20Metadata(_token).decimals())) /
            IPriceOracle(priceOracle).getPrice(_token, _mustUsePyth);
    }
}
