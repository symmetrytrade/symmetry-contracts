// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IPerpTracker {
    /*=== struct ===*/

    struct LpPosition {
        int longSize; // long position hold by lp in underlying, positive, 18 decimals
        int shortSize; // short position hold by lp in underlying, negative, 18 decimals
        int avgPrice; // average price for the lp net position (long + short)
        int accFunding; // accumulate funding fee for unit position size at the time of latest open/close position or lp in/out
        int accLongFinancingFee; // accumulate long financing fee for unit position size at the latest position modification
        int accShortFinancingFee; // accumulate short financing fee for unit position size at the latest position modification
    }

    struct Position {
        int size; // position size, positive for long, negative for short, 18 decimals
        int accFunding; // accumulate funding fee for unit position size at the latest position modification
        int accFinancingFee; // accumulate financing fee for unit position size at the latest position modification
        int avgPrice;
    }

    struct FeeInfo {
        int accFunding; // the latest accumulate funding fee for unit position size
        int fundingRate; // the latest funding rate
        int accLongFinancingFee; // the latest long financing fee
        int accShortFinancingFee; // the latest short financing fee
        int updateTime; // the latest fee update time
    }

    struct TokenInfo {
        int lpNetValue; // latest lp net value when any position of the token is updated
        int netOpenInterest; // latest net open interest when any position of the token is updated
        int skew; // latest token skew(in USD) when any position of the token is updated
    }

    /*=== event ===*/

    event NewMarket(address token);
    event RemoveMarket(address token);
    event MarginTransferred(address indexed account, int delta);
    event TokenInfoUpdated(address indexed token, int lpNetValue, int netOpenInterest, int skew);
    event FeeInfoUpdated(
        address indexed token,
        int nextFundingRate,
        int nextAccLongFinancingFee,
        int nextAccShortFinancingFee
    );
    event PositionUpdated(
        address indexed account,
        address indexed token,
        int size,
        int avgPrice,
        int accFunding,
        int accFinancingFee
    );

    /*=== function ===*/

    function addMargin(address _account, uint _amount) external;

    function computePerpFillPrice(
        address _token,
        int _size,
        int _oraclePrice,
        int _lpNetValue
    ) external view returns (int avgPrice);

    function computePerpFillPriceRaw(
        int _skew,
        int _size,
        int _oraclePrice,
        int _kLP,
        int _lambda
    ) external pure returns (int avgPrice);

    function computeTrade(
        int _size,
        int _avgPrice,
        int _sizeDelta,
        int _price
    ) external pure returns (int nextPrice, int pnl);

    function currentSkew(address _token) external view returns (int);

    function getFeeInfo(address _token) external view returns (FeeInfo memory);

    function getLpPosition(address _token) external view returns (LpPosition memory);

    function getNetPositionSize(address _token) external view returns (int, int);

    function getPosition(address _account, address _token) external view returns (Position memory);

    function getPositionSize(address _account, address _token) external view returns (int);

    function getTokenInfo(address _token) external view returns (TokenInfo memory);

    function latestUpdated(address _token) external view returns (uint);

    function lpHardLimit(int _lp) external view returns (int);

    function lpLimitForToken(int _lp, address _token) external view returns (int);

    function lpPositions(
        address
    )
        external
        view
        returns (
            int longSize,
            int shortSize,
            int avgPrice,
            int accFunding,
            int accLongFinancingFee,
            int accShortFinancingFee
        );

    function lpSoftLimit(int _lp) external view returns (int);

    function market() external view returns (address);

    function marketKey(address _token) external pure returns (bytes32);

    function marketTokensLength() external view returns (uint);

    function marketTokensList(uint) external view returns (address);

    function marketTokensListed(address) external view returns (bool);

    function nextAccFinancingFee(
        address _token,
        int _price
    ) external view returns (int nextAccLongFinancingFee, int nextAccShortFinancingFee);

    function nextAccFunding(address _token, int _price) external view returns (int, int);

    function removeMargin(address _account, uint _amount) external;

    function removeToken(uint _tokenIndex) external;

    function settings() external view returns (address);

    function settleTradeForLp(
        address _token,
        int _sizeDelta,
        int _execPrice,
        int _oldSize,
        int _newSize
    ) external returns (int);

    function settleTradeForUser(
        address _account,
        address _token,
        int _sizeDelta,
        int _execPrice
    ) external returns (int, int, int);

    function updateFee(address _token, int _price) external;

    function updateTokenInfo(address _token, TokenInfo memory _tokenInfo) external;

    function userMargin(address) external view returns (int);
}
