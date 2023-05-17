// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IMarket {
    /*=== event ===*/

    event Traded(
        address indexed account,
        address indexed token,
        int sizeDelta,
        int fillPrice,
        uint fee,
        uint couponUsed
    );

    event MarginTransferred(address indexed account, int delta);

    /*=== function ==*/

    function accountMarginStatus(
        address _account
    ) external view returns (int mtm, int currentMargin, int positionNotional);

    function baseToken() external view returns (address);

    function computePerpFillPrice(address _token, int _size) external view returns (int);

    function computePerpLiquidatePrice(address _account, address _token) external view returns (int, int, int);

    function coverDeficitLoss(address _account, int _loss) external returns (uint insuranceOut, uint lpOut);

    function deductFeeFromAccount(address _account, uint _fee, address _receiver) external returns (uint amount);

    function deductFeeFromInsurance(uint _fee, address _receiver) external returns (uint insuranceOut, uint lpOut);

    function deductFeeToLiquidity(address _account, uint _fee) external returns (uint amount);

    function deductPenaltyToInsurance(address _account, uint _fee) external returns (uint amount);

    function feeTracker() external view returns (address);

    function globalStatus() external view returns (int lpNetValue, int netOpenInterest);

    function insuranceBalance() external view returns (uint);

    function perpTracker() external view returns (address);

    function priceOracle() external view returns (address);

    function redeemTradingFee(address _account, int _lp, int _redeemValue) external returns (uint fee);

    function settings() external view returns (address);

    function tokenToUsd(address _token, int _amount, bool _mustUsePyth) external view returns (int);

    function trade(address _account, address _token, int _sizeDelta, int _price) external returns (int);

    function transferLiquidityIn(address _account, uint _amount) external;

    function transferLiquidityOut(address _account, uint _amount) external;

    function transferMarginIn(address _account, uint _amount) external;

    function transferMarginOut(address _account, uint _amount) external;

    function updateFee(address _token) external;

    function updateInfoWithPrice(address _token, bytes[] calldata _priceUpdateData) external payable;

    function updateTokenInfo(address _token) external returns (int, int);

    function usdToToken(address _token, int _amount, bool _mustUsePyth) external view returns (int);

    function userMargin(address) external view returns (int);

    function volumeTracker() external view returns (address);
}
