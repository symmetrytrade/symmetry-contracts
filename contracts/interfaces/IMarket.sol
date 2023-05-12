// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IMarket {
    /*=== event ===*/

    event Traded(
        address indexed account,
        address indexed token,
        int256 sizeDelta,
        int256 price,
        uint256 fee,
        uint256 couponUsed
    );

    /*=== function ==*/

    function accountMarginStatus(
        address _account
    ) external view returns (int256 mtm, int256 currentMargin, int256 positionNotional);

    function baseToken() external view returns (address);

    function computePerpFillPrice(address _token, int256 _size) external view returns (int256);

    function computePerpLiquidatePrice(address _account, address _token) external view returns (int256, int256, int256);

    function coverDeficitLoss(address _account, int256 _loss) external returns (uint256 insuranceOut, uint256 lpOut);

    function deductFeeFromAccount(address _account, uint256 _fee, address _receiver) external returns (uint256 amount);

    function deductFeeFromInsurance(
        uint256 _fee,
        address _receiver
    ) external returns (uint256 insuranceOut, uint256 lpOut);

    function deductFeeToLiquidity(address _account, uint256 _fee) external returns (uint256 amount);

    function deductPenaltyToInsurance(address _account, uint256 _fee) external returns (uint256 amount);

    function feeTracker() external view returns (address);

    function globalStatus() external view returns (int256 lpNetValue, int256 netOpenInterest);

    function insuranceBalance() external view returns (uint256);

    function perpTracker() external view returns (address);

    function priceOracle() external view returns (address);

    function redeemTradingFee(address _account, int _lp, int _redeemValue) external returns (uint fee);

    function settings() external view returns (address);

    function tokenToUsd(address _token, int256 _amount, bool _mustUsePyth) external view returns (int256);

    function trade(address _account, address _token, int256 _sizeDelta, int256 _price) external returns (int256);

    function transferLiquidityIn(address _account, uint256 _amount) external;

    function transferLiquidityOut(address _account, uint256 _amount) external;

    function transferMarginIn(address _account, uint256 _amount) external;

    function transferMarginOut(address _account, uint256 _amount) external;

    function updateFee(address _token) external;

    function updateInfoWithPrice(address _token, bytes[] calldata _priceUpdateData) external payable;

    function updateTokenInfo(address _token) external returns (int256, int256);

    function usdToToken(address _token, int256 _amount, bool _mustUsePyth) external view returns (int256);

    function volumeTracker() external view returns (address);
}
