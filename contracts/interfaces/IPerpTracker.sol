// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IPerpTracker {
    /*=== struct ===*/

    struct LpPosition {
        int256 longSize; // long position hold by lp in underlying, positive, 18 decimals
        int256 shortSize; // short position hold by lp in underlying, negative, 18 decimals
        int256 avgPrice; // average price for the lp net position (long + short)
        int256 accFunding; // accumulate funding fee for unit position size at the time of latest open/close position or lp in/out
        int256 accLongFinancingFee; // accumulate long financing fee for unit position size at the latest position modification
        int256 accShortFinancingFee; // accumulate short financing fee for unit position size at the latest position modification
    }

    struct Position {
        int256 size; // position size, positive for long, negative for short, 18 decimals
        int256 accFunding; // accumulate funding fee for unit position size at the latest position modification
        int256 accFinancingFee; // accumulate financing fee for unit position size at the latest position modification
        int256 avgPrice;
    }

    struct FeeInfo {
        int256 accFunding; // the latest accumulate funding fee for unit position size
        int256 fundingRate; // the latest funding rate
        int256 accLongFinancingFee; // the latest long financing fee
        int256 accShortFinancingFee; // the latest short financing fee
        int256 updateTime; // the latest fee update time
    }

    struct TokenInfo {
        int256 lpNetValue; // latest lp net value when any position of the token is updated
        int256 netOpenInterest; // latest net open interest when any position of the token is updated
        int256 skew; // latest token skew(in USD) when any position of the token is updated
    }

    /*=== event ===*/

    event MarginTransferred(address indexed account, int256 delta);
    event TokenInfoUpdated(address indexed token, int256 lpNetValue, int256 netOpenInterest, int256 skew);
    event FeeInfoUpdated(
        address indexed token,
        int256 nextAccFundingFee,
        int256 nextFundingRate,
        int256 nextAccLongFinancingFee,
        int256 nextAccShortFinancingFee,
        uint256 updateTime
    );

    /*=== function ===*/

    function addMargin(address _account, uint256 _amount) external;

    function computeFinancingFee(address _account, address _token) external view returns (int256);

    function computeLpFunding(address _token) external view returns (int256);

    function computePerpFillPrice(
        address _token,
        int256 _size,
        int256 _oraclePrice,
        int256 _lpNetValue
    ) external view returns (int256 avgPrice);

    function computePerpFillPriceRaw(
        int256 _skew,
        int256 _size,
        int256 _oraclePrice,
        int256 _kLP,
        int256 _lambda
    ) external pure returns (int256 avgPrice);

    function computeTrade(
        int256 _size,
        int256 _avgPrice,
        int256 _sizeDelta,
        int256 _price
    ) external pure returns (int256 nextPrice, int256 pnl);

    function currentSkew(address _token) external view returns (int256);

    function getFeeInfo(address _token) external view returns (FeeInfo memory);

    function getLpPosition(address _token) external view returns (LpPosition memory);

    function getNetPositionSize(address _token) external view returns (int256, int256);

    function getPosition(address _account, address _token) external view returns (Position memory);

    function getPositionSize(address _account, address _token) external view returns (int256);

    function getTokenInfo(address _token) external view returns (TokenInfo memory);

    function latestUpdated(address _token) external view returns (uint256);

    function lpHardLimit(int256 _lp) external view returns (int256);

    function lpLimitForToken(int256 _lp, address _token) external view returns (int256);

    function lpPositions(
        address
    )
        external
        view
        returns (
            int256 longSize,
            int256 shortSize,
            int256 avgPrice,
            int256 accFunding,
            int256 accLongFinancingFee,
            int256 accShortFinancingFee
        );

    function lpSoftLimit(int256 _lp) external view returns (int256);

    function market() external view returns (address);

    function marketKey(address _token) external pure returns (bytes32);

    function marketTokensLength() external view returns (uint256);

    function marketTokensList(uint256) external view returns (address);

    function marketTokensListed(address) external view returns (bool);

    function nextAccFinancingFee(
        address _token,
        int256 _price
    ) external view returns (int256 nextAccLongFinancingFee, int256 nextAccShortFinancingFee);

    function nextAccFunding(address _token, int256 _price) external view returns (int256, int256);

    function removeMargin(address _account, uint256 _amount) external;

    function removeToken(uint256 _tokenIndex) external;

    function settings() external view returns (address);

    function settleFunding(address _account, address _token) external;

    function settleTradeForLp(
        address _token,
        int256 _sizeDelta,
        int256 _execPrice,
        int256 _oldSize,
        int256 _newSize
    ) external returns (int256);

    function settleTradeForUser(
        address _account,
        address _token,
        int256 _sizeDelta,
        int256 _execPrice
    ) external returns (int256, int256);

    function updateFee(address _token, int256 _price) external;

    function updateTokenInfo(address _token, TokenInfo memory _tokenInfo) external;

    function userMargin(address) external view returns (int256);
}
