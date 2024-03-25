// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import "../utils/ABDKMath64x64.sol";

contract BS {
    using ABDKMath64x64 for int128;

    // constants
    int128 public immutable PI = _to64x64(3_141592653589793238, 18);
    int128 public immutable N_1_0 = _to64x64(1, 0);
    int128 public immutable N_2_0 = _to64x64(2, 0);
    int128 public immutable N_0_2316419 = _to64x64(2316419, 7);
    int128 public immutable N_0_319381530 = _to64x64(319381530, 9);
    int128 public immutable N_N0_356563782 = _to64x64(-356563782, 9);
    int128 public immutable N_1_781477937 = _to64x64(1781477937, 9);
    int128 public immutable N_N1_821255978 = _to64x64(-1821255978, 9);
    int128 public immutable N_1_330274429 = _to64x64(1330274429, 9);
    int128 public immutable N_0_5 = _to64x64(5, 1);
    int128 public immutable N_N0_5 = _to64x64(-5, 1);

    function _to64x64(int _x, uint8 _decimals) internal pure returns (int128) {
        return int128((_x << 64) / int(10 ** _decimals));
    }

    function normCdf(int128 _x) public view returns (int128) {
        int128 k = N_1_0.div(N_1_0.add(N_0_2316419.mul(_x)));
        int128 kSum = k.mul(N_1_330274429);
        kSum = k.mul(kSum.add(N_N1_821255978));
        kSum = k.mul(kSum.add(N_1_781477937));
        kSum = k.mul(kSum.add(N_N0_356563782));
        kSum = k.mul(kSum.add(N_0_319381530));
        return
            N_1_0 -
            N_1_0.div(ABDKMath64x64.sqrt(N_2_0.mul(PI))).mul(ABDKMath64x64.exp(N_N0_5.mul(_x).mul(_x))).mul(kSum);
    }

    /**
     * @dev compute the option price, all inputs and output are int with 8 decimals
     * @param _spotPrice spot price
     * @param _strikePrice strike price
     * @param _ir risk-free interest rate
     * @param _t time to maturity
     * @param _vol volatility
     */
    function blackScholes(int _spotPrice, int _strikePrice, int _ir, int _t, int _vol) public view returns (int) {
        return
            _blackScholes(
                _to64x64(_spotPrice, 8),
                _to64x64(_strikePrice, 8),
                _to64x64(_ir, 8),
                _to64x64(_t, 8),
                _to64x64(_vol, 8)
            ).toInt();
    }

    function _blackScholes(int128 _st, int128 _k, int128 _r, int128 _t, int128 _vol) public view returns (int128) {
        int128 volXSqrtT = _vol.mul(ABDKMath64x64.sqrt(_t));
        int128 d1 = ABDKMath64x64.ln(_st.div(_k)).add(_r.add(_vol.mul(_vol).div(N_2_0)).mul(_t)).div(volXSqrtT);
        int128 d2 = d1 - volXSqrtT;
        return normCdf(d1).mul(_st).sub(normCdf(d2).mul(_k.mul(ABDKMath64x64.exp(_r.mul(_t).neg()))));
    }

    function run(uint _times) public view {
        int spotPrice = 3000e8;
        int strikePrice = 3500e8;
        int ir = 1e8;
        int t = 1;
        int vol = 5e8;
        for (uint i = 0; i < _times; ++i) {
            blackScholes(spotPrice, strikePrice, ir, t, vol);
        }
    }
}
