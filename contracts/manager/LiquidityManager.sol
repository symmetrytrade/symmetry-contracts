// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../market/Market.sol";
import "../market/MarketSettings.sol";
import "../utils/SafeDecimalMath.sol";
import "../utils/SafeCast.sol";
import "../utils/Initializable.sol";
import "../tokenomics/LPToken.sol";

contract LiquidityManager is Ownable, Initializable {
    using SignedSafeDecimalMath for int256;
    using SafeDecimalMath for uint256;
    using SafeCast for int256;
    using SafeCast for uint256;

    // setting keys
    bytes32 public constant LIQUIDITY_REMOVE_COOLDOWN =
        "liquidityRemoveCooldown";

    // states
    address public market;
    address public lpToken;
    mapping(address => uint256) public latestMint;

    event AddLiquidity(
        address account,
        uint256 amount,
        int256 lpNetValue,
        uint256 usdAmount,
        uint256 mintAmount
    );

    event RemoveLiquidity(
        address account,
        uint256 burnAmount,
        int256 lpNetValue,
        uint256 burnUsdAmount,
        uint256 amountOut
    );

    /*=== initialize ===*/

    function initialize(
        address _market,
        address _lpToken
    ) external onlyInitializeOnce {
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

    function addLiquidity(
        uint256 _amount,
        uint256 _minUsd,
        uint256 _minLp,
        address _receiver
    ) external returns (uint256) {
        return _addLiquidity(msg.sender, _amount, _minUsd, _minLp, _receiver);
    }

    function removeLiquidity(
        uint256 _amount,
        uint256 _minOut,
        address _receiver
    ) external returns (uint256) {
        return _removeLiquidity(msg.sender, _amount, _minOut, _receiver);
    }

    function _addLiquidity(
        address _account,
        uint256 _amount,
        uint256 _minUsd,
        uint256 _minLp,
        address _receiver
    ) internal returns (uint256) {
        Market market_ = Market(market);
        // usd value check
        uint256 usdAmount = market_
            .tokenToUsd(market_.baseToken(), _amount.toInt256(), false)
            .toUint256();
        require(
            usdAmount >= _minUsd,
            "LiquidityManager: insufficient usd amount"
        );
        // transfer funds
        market_.transferLiquidityIn(_account, _amount);
        // mint lp tokens
        LPToken lpToken_ = LPToken(lpToken);
        uint256 lpSupply = lpToken_.totalSupply();
        uint256 mintAmount = usdAmount;
        int256 lpNetValue = 0;
        if (lpSupply > 0) {
            (lpNetValue, , ) = market_.globalStatus();
            if (lpNetValue > 0)
                mintAmount = (lpSupply * usdAmount) / uint256(lpNetValue);
        }
        require(
            mintAmount >= _minLp,
            "LiquidityManager: insufficient lp amount"
        );
        latestMint[_receiver] = block.timestamp;
        lpToken_.mint(_receiver, mintAmount);

        emit AddLiquidity(
            _receiver,
            _amount,
            lpNetValue,
            usdAmount,
            mintAmount
        );
        return mintAmount;
    }

    function _removeLiquidity(
        address _account,
        uint256 _amount,
        uint256 _minOut,
        address _receiver
    ) internal returns (uint256) {
        Market market_ = Market(market);
        // check cooldown
        // this cooldown is used to avoid front-run and flashloan that manipulating funding fee
        require(
            block.timestamp >=
                latestMint[_account] +
                    MarketSettings(market_.settings()).getUintVals(
                        LIQUIDITY_REMOVE_COOLDOWN
                    ),
            "LiquidityManager: remove is in cooldown"
        );
        // check lp token price and free lp value
        (int lpNetValue, int longOpenInterest, int shortOpenInterest) = market_
            .globalStatus();
        require(lpNetValue > 0, "LiquidityManager: lp bankrupted");
        LPToken lpToken_ = LPToken(lpToken);
        int256 burnValue = (lpNetValue * _amount.toInt256()) /
            lpToken_.totalSupply().toInt256(); // must be non-negative
        require(
            lpNetValue - longOpenInterest.max(shortOpenInterest) >= burnValue,
            "LiquidityManager: insufficient free lp"
        );
        // burn lp
        lpToken_.burn(_account, _amount);
        // withdraw token
        uint256 amountOut = market_
            .usdToToken(market_.baseToken(), burnValue, false)
            .toUint256();
        require(
            amountOut >= _minOut,
            "LiquidityManager: insufficient amountOut"
        );
        market_.transferLiquidityOut(_receiver, amountOut);

        emit RemoveLiquidity(
            _account,
            _amount,
            lpNetValue,
            burnValue.toUint256(),
            amountOut
        );

        return 0;
    }
}
