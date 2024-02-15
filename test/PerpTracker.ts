import hre, { deployments } from "hardhat";
import { expect } from "chai";
import { CONTRACTS, UNIT, getTypedContract, normalized, perpDomainKey } from "../src/utils/utils";
import { ethers } from "ethers";
import { increaseNextBlockTimestamp } from "../src/utils/test_utils";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";

describe("PerpTracker", () => {
    let perpTracker_: ethers.Contract;
    let WETH: string;
    let WBTC: string;

    before(async () => {
        await deployments.fixture();
        const { deployer } = await hre.getNamedAccounts();
        perpTracker_ = await getTypedContract(hre, CONTRACTS.PerpTracker);
        WETH = await (await getTypedContract(hre, CONTRACTS.WETH)).getAddress();
        WBTC = await (await getTypedContract(hre, CONTRACTS.WBTC)).getAddress();
        // set market to deployer for test
        await (await perpTracker_.setMarket(deployer)).wait();
    });

    async function swapOnAMM(
        skew: string,
        size: string,
        expectedFillPrice: string,
        expectedLongByMidPrice: string,
        expectedShortByMidPrice: string,
        nextBlockDelay: number
    ) {
        const oraclePrice = normalized(2000);
        const kLP = normalized(10000 * 2000);
        const fillPrice = await perpTracker_.swapOnAMM.staticCall([WETH, skew, size, oraclePrice, kLP]);
        assertDiffWithin(fillPrice, expectedFillPrice, "2000");
        await (await perpTracker_.swapOnAMM([WETH, skew, size, oraclePrice, kLP])).wait();
        const priceInfo = await perpTracker_.getPriceInfo(WETH);
        assertDiffWithin(priceInfo.longByMidPrice, expectedLongByMidPrice, "1");
        assertDiffWithin(priceInfo.shortByMidPrice, expectedShortByMidPrice, "1");
        await increaseNextBlockTimestamp(nextBlockDelay);
        await helpers.mine();
    }

    function assertDiffWithin(x: ethers.BigNumberish, y: ethers.BigNumberish, maxDiff: ethers.BigNumberish) {
        expect(BigInt(x) - BigInt(y)).to.be.within(-BigInt(maxDiff), BigInt(maxDiff));
    }

    function div(x: number, y: number) {
        return ((BigInt(x) * UNIT) / BigInt(y)).toString();
    }

    it("swapOnAMM", async () => {
        // oracle price = 2000 USDC/ETH
        // lambda = 0.5
        // kLP = 10000 ETH
        let skew = 0;
        // case 1: trade 1000 ETH, p_{mid}=2000, p'_{mid}=2100, p_{exec}=2050
        // buy price evenly distributed from p_{buy} and p'_{mid}
        await swapOnAMM(normalized(skew), normalized(1000), normalized(2050), normalized(1), div(2000, 2100), 2);
        skew += 1000;
        // case 2: trade -500 ETH, p_{mid}=2100, p'_{mid}=2050, p_{exec}=2020
        // sell price is exactly p_{sell}
        await swapOnAMM(normalized(skew), normalized(-500), normalized(2020), div(2100, 2050), div(2020, 2050), 5);
        skew -= 500;
        // case 3: trade 100 ETH, p_{mid}=2050, p'_{mid}=2060, p_{exec}=2075
        // buy price is exactly p_{buy}
        await swapOnAMM(normalized(skew), normalized(100), normalized(2075), div(2075, 2060), div(2035, 2060), 10);
        skew += 100;
        // case 4: trade -600 ETH, p_{mid}=2060, p'_{mid}=2000, p_{exec}=2030
        // sell price is evenly distributed between p_{sell} and p'_{mid}
        await swapOnAMM(normalized(skew), normalized(-600), normalized(2030), div(2060, 2000), normalized(1), 5);
        skew -= 600;
        // case 5: trade 1000 ETH, p_{mid}=2000, p'_{mid}=2100, p_{exec}=((2030-2000)*2030+(2100-2030)*2065)/100=2054.5
        // sell price is weighted average between p_{mid} to p'_{mid}
        await swapOnAMM(normalized(skew), normalized(1000), normalized(2054.5), normalized(1), div(2000, 2100), 5);
        skew += 1000;
        // case 6: trade -2000 ETH, p_{mid}=2100, p'_{mid}=1900, p_{exec}=((2100-2050)*2050+(2050-1900)*1975)/200=1993.75
        // sell price is weighted average between p_{mid} to p'_{mid}
        await swapOnAMM(normalized(skew), normalized(-2000), normalized(1993.75), div(2100, 1900), normalized(1), 5);
        skew -= 2000;
    });

    it("market key", async () => {
        const domainKey = await perpTracker_.domainKey(WETH);
        expect(domainKey).to.be.eq(perpDomainKey(WETH));
    });

    it("listed tokens", async () => {
        const tokenLength = await perpTracker_.marketTokensLength();
        expect(tokenLength).to.deep.eq(2);
        expect(await perpTracker_.marketTokensList(0)).to.be.eq(WBTC);
        expect(await perpTracker_.marketTokensList(1)).to.be.eq(WETH);
    });

    it("remove tokens", async () => {
        await (await perpTracker_.removeMarketToken(WBTC)).wait();
        const tokenLength = await perpTracker_.marketTokensLength();
        expect(tokenLength).to.deep.eq(1);
        expect(await perpTracker_.marketTokensList(0)).to.be.eq(WETH);
    });
});
