import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "ethers";
import hre, { deployments } from "hardhat";
import { increaseNextBlockTimestamp } from "../src/utils/test_utils";
import { CONTRACTS, div_D, getTypedContract, normalized, perpDomainKey } from "../src/utils/utils";
import { FaucetToken, PerpTracker } from "../typechain-types";

describe("PerpTracker", () => {
    let perpTracker_: PerpTracker;
    let WETH_: FaucetToken;
    let WBTC_: FaucetToken;

    before(async () => {
        await deployments.fixture();
        const { deployer } = await hre.getNamedAccounts();
        perpTracker_ = await getTypedContract(hre, CONTRACTS.PerpTracker);
        WETH_ = await getTypedContract(hre, CONTRACTS.WETH);
        WBTC_ = await getTypedContract(hre, CONTRACTS.WBTC);
        // set market to deployer for test
        await perpTracker_.setMarket(deployer);
    });

    async function swapOnAMM(
        skew: ethers.BigNumberish,
        size: ethers.BigNumberish,
        expectedFillPrice: ethers.BigNumberish,
        expectedLongByMidPrice: ethers.BigNumberish,
        expectedShortByMidPrice: ethers.BigNumberish,
        nextBlockDelay: number
    ) {
        const oraclePrice = normalized(2000);
        const kLP = normalized(10000 * 2000);
        const fillPrice = await perpTracker_.swapOnAMM.staticCall({
            token: WETH_,
            skew,
            size,
            oraclePrice,
            lpNetValue: kLP,
        });
        assertDiffWithin(fillPrice, expectedFillPrice, "2000");
        await perpTracker_.swapOnAMM({ token: WETH_, skew, size, oraclePrice, lpNetValue: kLP });
        const priceInfo = await perpTracker_.getPriceInfo(WETH_);
        assertDiffWithin(priceInfo.longByMidPrice, expectedLongByMidPrice, "1");
        assertDiffWithin(priceInfo.shortByMidPrice, expectedShortByMidPrice, "1");
        await increaseNextBlockTimestamp(nextBlockDelay);
        await helpers.mine();
    }

    function assertDiffWithin(x: ethers.BigNumberish, y: ethers.BigNumberish, maxDiff: ethers.BigNumberish) {
        expect(BigInt(x) - BigInt(y)).to.be.within(-BigInt(maxDiff), BigInt(maxDiff));
    }

    it("swapOnAMM", async () => {
        // oracle price = 2000 USDC/ETH
        // lambda = 0.5
        // kLP = 10000 ETH
        let skew = 0;
        // case 1: trade 1000 ETH, p_{mid}=2000, p'_{mid}=2100, p_{exec}=2050
        // buy price evenly distributed from p_{buy} and p'_{mid}
        await swapOnAMM(normalized(skew), normalized(1000), normalized(2050), normalized(1), div_D(2000, 2100), 2);
        skew += 1000;
        // case 2: trade -500 ETH, p_{mid}=2100, p'_{mid}=2050, p_{exec}=2020
        // sell price is exactly p_{sell}
        await swapOnAMM(normalized(skew), normalized(-500), normalized(2020), div_D(2100, 2050), div_D(2020, 2050), 5);
        skew -= 500;
        // case 3: trade 100 ETH, p_{mid}=2050, p'_{mid}=2060, p_{exec}=2075
        // buy price is exactly p_{buy}
        await swapOnAMM(normalized(skew), normalized(100), normalized(2075), div_D(2075, 2060), div_D(2035, 2060), 10);
        skew += 100;
        // case 4: trade -600 ETH, p_{mid}=2060, p'_{mid}=2000, p_{exec}=2030
        // sell price is evenly distributed between p_{sell} and p'_{mid}
        await swapOnAMM(normalized(skew), normalized(-600), normalized(2030), div_D(2060, 2000), normalized(1), 5);
        skew -= 600;
        // case 5: trade 1000 ETH, p_{mid}=2000, p'_{mid}=2100, p_{exec}=((2030-2000)*2030+(2100-2030)*2065)/100=2054.5
        // sell price is weighted average between p_{mid} to p'_{mid}
        await swapOnAMM(normalized(skew), normalized(1000), normalized("2054.5"), normalized(1), div_D(2000, 2100), 5);
        skew += 1000;
        // case 6: trade -2000 ETH, p_{mid}=2100, p'_{mid}=1900, p_{exec}=((2100-2050)*2050+(2050-1900)*1975)/200=1993.75
        // sell price is weighted average between p_{mid} to p'_{mid}
        await swapOnAMM(
            normalized(skew),
            normalized(-2000),
            normalized("1993.75"),
            div_D(2100, 1900),
            normalized(1),
            5
        );
        skew -= 2000;
    });

    it("market key", async () => {
        const domainKey = await perpTracker_.domainKey(WETH_);
        expect(domainKey).to.be.eq(await perpDomainKey(WETH_));
    });

    it("listed tokens", async () => {
        const tokenLength = await perpTracker_.marketTokensLength();
        expect(tokenLength).to.eq(2);
        expect(await perpTracker_.marketTokensList(0)).to.be.eq(WBTC_);
        expect(await perpTracker_.marketTokensList(1)).to.be.eq(WETH_);
    });

    it("remove tokens", async () => {
        await perpTracker_.removeMarketToken(WBTC_);
        const tokenLength = await perpTracker_.marketTokensLength();
        expect(tokenLength).to.eq(1);
        expect(await perpTracker_.marketTokensList(0)).to.be.eq(WETH_);
    });
});
