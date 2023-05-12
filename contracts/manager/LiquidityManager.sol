// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

import "../utils/SafeDecimalMath.sol";
import "../utils/Initializable.sol";

import "../interfaces/IMarketSettings.sol";
import "../interfaces/IMarket.sol";

import "../market/MarketSettingsContext.sol";

import "../tokens/LPToken.sol";

contract LiquidityManager is MarketSettingsContext, Ownable, Initializable {
    using SignedSafeDecimalMath for int;
    using SafeDecimalMath for uint;
    using SafeCast for int;
    using SafeCast for uint;

    // states
    address public market;
    address public lpToken;
    mapping(address => uint) public latestMint;

    event AddLiquidity(address account, uint amount, int lpNetValue, uint usdAmount, uint mintAmount);

    event RemoveLiquidity(
        address account,
        uint redeemAmount,
        int lpNetValue,
        uint redeemUsdAmount,
        uint redeemFee,
        uint amountOut
    );

    /*=== initialize ===*/

    function initialize(address _market, address _lpToken) external onlyInitializeOnce {
        market = _market;
        lpToken = _lpToken;

        _transferOwnership(msg.sender);
    }

    /*=== owner functions ===*/

    function setMarket(address _market, address _lpToken) external onlyOwner {
        market = _market;
        lpToken = _lpToken;
    }

    /*=== liquidity ===*/

    function addLiquidity(uint _amount, uint _minUsd, uint _minLp, address _receiver) external returns (uint) {
        return _addLiquidity(msg.sender, _amount, _minUsd, _minLp, _receiver);
    }

    function removeLiquidity(uint _amount, uint _minOut, address _receiver) external returns (uint) {
        return _removeLiquidity(msg.sender, _amount, _minOut, _receiver);
    }

    function _addLiquidity(
        address _account,
        uint _amount,
        uint _minUsd,
        uint _minLp,
        address _receiver
    ) internal returns (uint) {
        IMarket market_ = IMarket(market);
        // usd value check
        uint usdAmount = market_.tokenToUsd(market_.baseToken(), _amount.toInt256(), false).toUint256();
        require(usdAmount >= _minUsd, "LiquidityManager: insufficient usd amount");
        // mint lp tokens
        LPToken lpToken_ = LPToken(lpToken);
        uint lpSupply = lpToken_.totalSupply();
        uint mintAmount = usdAmount;
        int lpNetValue = 0;
        if (lpSupply > 0) {
            (lpNetValue, ) = market_.globalStatus();
            if (lpNetValue > 0) mintAmount = (lpSupply * usdAmount) / uint(lpNetValue);
        }
        require(mintAmount >= _minLp, "LiquidityManager: insufficient lp amount");
        latestMint[_receiver] = block.timestamp;
        // transfer funds
        market_.transferLiquidityIn(_account, _amount);
        lpToken_.mint(_receiver, mintAmount);

        emit AddLiquidity(_receiver, _amount, lpNetValue, usdAmount, mintAmount);
        return mintAmount;
    }

    function _removeLiquidity(address _account, uint _amount, uint _minOut, address _receiver) internal returns (uint) {
        IMarket market_ = IMarket(market);
        // check lp token price and free lp value
        (int lpNetValue, int netOpenInterest) = market_.globalStatus();
        require(lpNetValue > 0, "LiquidityManager: lp bankrupted");
        LPToken lpToken_ = LPToken(lpToken);
        int redeemValue = (lpNetValue * _amount.toInt256()) / lpToken_.totalSupply().toInt256(); // must be non-negative
        int redeemFee = 0;
        {
            // redeem trade
            redeemFee += IMarket(market).redeemTradingFee(_account, lpNetValue, redeemValue).toInt256();
            // redeem fee
            redeemFee += IMarketSettings(market_.settings()).getIntVals(LIQUIDITY_REDEEM_FEE).multiplyDecimal(
                redeemValue - redeemFee
            );
            // TODO: where the fee goes?
        }
        require(redeemValue > redeemFee, "LiquidityManager: non-positive redeem value");
        require(lpNetValue - netOpenInterest >= redeemValue - redeemFee, "LiquidityManager: insufficient free lp");
        // burn lp
        lpToken_.burn(_account, _amount);
        // withdraw token
        uint amountOut = market_.usdToToken(market_.baseToken(), redeemValue - redeemFee, false).toUint256();
        require(amountOut >= _minOut, "LiquidityManager: insufficient amountOut");
        market_.transferLiquidityOut(_receiver, amountOut);

        emit RemoveLiquidity(_account, _amount, lpNetValue, redeemValue.toUint256(), redeemFee.toUint256(), amountOut);

        return amountOut;
    }
}
