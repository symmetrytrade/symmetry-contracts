import hre, { deployments } from "hardhat";
import { expect } from "chai";
import {
    ADDR0,
    CONTRACTS,
    getProxyContract,
    normalized,
    perpMarketKey,
} from "../src/utils/utils";
import { ethers } from "ethers";

describe("PerpTracker", () => {
    let perpTracker_: ethers.Contract;
    let WETH: string;
    let WBTC: string;

    before(async () => {
        await deployments.fixture();
        const { deployer } = await hre.getNamedAccounts();
        perpTracker_ = await getProxyContract(
            hre,
            CONTRACTS.PerpTracker,
            deployer
        );
        WETH = (await hre.ethers.getContract("WETH")).address;
        WBTC = (await hre.ethers.getContract("WBTC")).address;
    });

    it("computePerpFillPriceRaw", async () => {
        // oracle price = 2000 USDC/ETH
        // lambda = 0.5
        // kLP = 10000 ETH
        const oraclePrice = normalized(2000);
        const lambda = normalized(0.5);
        const kLP = normalized(10000);
        let skew, size, fillPrice;

        // case 1: skew = 1000 ETH, size = 1000 ETH
        skew = normalized(1000);
        size = normalized(1000);
        fillPrice = await perpTracker_.computePerpFillPriceRaw(
            skew,
            size,
            oraclePrice,
            kLP,
            lambda
        );
        expect(fillPrice).to.deep.eq(normalized(2150));
        // case 2: skew = 1000 ETH, size = 10000 ETH
        skew = normalized(1000);
        size = normalized(10000);
        fillPrice = await perpTracker_.computePerpFillPriceRaw(
            skew,
            size,
            oraclePrice,
            kLP,
            lambda
        );
        expect(fillPrice).to.deep.eq(normalized(2595));
        // case 3: skew = 15000 ETH, size = 1000 ETH
        skew = normalized(15000);
        size = normalized(1000);
        fillPrice = await perpTracker_.computePerpFillPriceRaw(
            skew,
            size,
            oraclePrice,
            kLP,
            lambda
        );
        expect(fillPrice).to.deep.eq(normalized(3000));
        // case 4: skew = 0 ETH, size = -1000 ETH
        skew = normalized(0);
        size = normalized(-1000);
        fillPrice = await perpTracker_.computePerpFillPriceRaw(
            skew,
            size,
            oraclePrice,
            kLP,
            lambda
        );
        expect(fillPrice).to.deep.eq(normalized(1950));
        // case 5: skew = -1000 ETH, size = -10000 ETH
        skew = normalized(-1000);
        size = normalized(-10000);
        fillPrice = await perpTracker_.computePerpFillPriceRaw(
            skew,
            size,
            oraclePrice,
            kLP,
            lambda
        );
        expect(fillPrice).to.deep.eq(normalized(1405));
        // case 6: skew = -15000 ETH, size = -1000 ETH
        skew = normalized(-15000);
        size = normalized(-1000);
        fillPrice = await perpTracker_.computePerpFillPriceRaw(
            skew,
            size,
            oraclePrice,
            kLP,
            lambda
        );
        expect(fillPrice).to.deep.eq(normalized(1000));
        // case 7: skew = 15000 ETH, size = -10000 ETH
        skew = normalized(15000);
        size = normalized(-10000);
        fillPrice = await perpTracker_.computePerpFillPriceRaw(
            skew,
            size,
            oraclePrice,
            kLP,
            lambda
        );
        expect(fillPrice).to.deep.eq(normalized(2000));
        // case 8: skew = 20000 ETH, size = -25000 ETH
        skew = normalized(20000);
        size = normalized(-25000);
        fillPrice = await perpTracker_.computePerpFillPriceRaw(
            skew,
            size,
            oraclePrice,
            kLP,
            lambda
        );
        expect(fillPrice).to.deep.eq(normalized(1950));
        // case 9: skew = 20000 ETH, size = -50000 ETH
        skew = normalized(20000);
        size = normalized(-50000);
        fillPrice = await perpTracker_.computePerpFillPriceRaw(
            skew,
            size,
            oraclePrice,
            kLP,
            lambda
        );
        expect(fillPrice).to.deep.eq("1499999999999999998000");
        // case 10: skew = -15000 ETH, size = 10000 ETH
        skew = normalized(-15000);
        size = normalized(10000);
        fillPrice = await perpTracker_.computePerpFillPriceRaw(
            skew,
            size,
            oraclePrice,
            kLP,
            lambda
        );
        expect(fillPrice).to.deep.eq(normalized(2000));
        // case 11: skew = -20000 ETH, size = 25000 ETH
        skew = normalized(-20000);
        size = normalized(25000);
        fillPrice = await perpTracker_.computePerpFillPriceRaw(
            skew,
            size,
            oraclePrice,
            kLP,
            lambda
        );
        expect(fillPrice).to.deep.eq(normalized(2050));
        // case 12: skew = -20000 ETH, size = 50000 ETH
        skew = normalized(-20000);
        size = normalized(50000);
        fillPrice = await perpTracker_.computePerpFillPriceRaw(
            skew,
            size,
            oraclePrice,
            kLP,
            lambda
        );
        expect(fillPrice).to.deep.eq("2499999999999999998000");
    });

    it("market key", async () => {
        const marketKey = await perpTracker_.marketKey(WETH);
        expect(marketKey).to.be.eq(perpMarketKey(WETH));
    });

    it("listed tokens", async () => {
        const tokenLength = await perpTracker_.marketTokensLength();
        expect(tokenLength).to.deep.eq(2);
        expect(await perpTracker_.marketTokensList(0)).to.be.eq(WBTC);
        expect(await perpTracker_.marketTokensList(1)).to.be.eq(WETH);
    });

    it("remove tokens", async () => {
        await expect(perpTracker_.removeToken(2)).to.be.revertedWith(
            "PerpTracker: token index out of bound"
        );

        await (await perpTracker_.removeToken(0)).wait();
        const tokenLength = await perpTracker_.marketTokensLength();
        expect(tokenLength).to.deep.eq(1);
        expect(await perpTracker_.marketTokensList(0)).to.be.eq(WETH);
    });

    it("compute trade", async () => {
        let ans;

        // case 1: increase long position
        ans = await perpTracker_.computeTrade(
            normalized(2),
            normalized(1000),
            normalized(6),
            normalized(2000)
        );
        expect(ans.nextPrice).to.deep.eq(normalized(1750));

        // case 2: increase short position
        ans = await perpTracker_.computeTrade(
            normalized(-2),
            normalized(1000),
            normalized(-6),
            normalized(2000)
        );
        expect(ans.nextPrice).to.deep.eq(normalized(1750));

        // case 3: increase long position from zero
        ans = await perpTracker_.computeTrade(
            normalized(0),
            normalized(1000),
            normalized(6),
            normalized(2000)
        );
        expect(ans.nextPrice).to.deep.eq(normalized(2000));

        // case 4: increase short position from zero
        ans = await perpTracker_.computeTrade(
            normalized(0),
            normalized(1000),
            normalized(-6),
            normalized(2000)
        );
        expect(ans.nextPrice).to.deep.eq(normalized(2000));

        // case 5: decrease long position
        ans = await perpTracker_.computeTrade(
            normalized(10),
            normalized(1000),
            normalized(-6),
            normalized(2000)
        );
        expect(ans.nextPrice).to.deep.eq(normalized(1000));

        // case 5: decrease long position
        ans = await perpTracker_.computeTrade(
            normalized(10),
            normalized(1000),
            normalized(-6),
            normalized(2000)
        );
        expect(ans.nextPrice).to.deep.eq(normalized(1000));

        // case 6: decrease short position
        ans = await perpTracker_.computeTrade(
            normalized(-10),
            normalized(1000),
            normalized(6),
            normalized(2000)
        );
        expect(ans.nextPrice).to.deep.eq(normalized(1000));

        // case 7: decrease long position, flip the position direction
        ans = await perpTracker_.computeTrade(
            normalized(10),
            normalized(1000),
            normalized(-20),
            normalized(2000)
        );
        expect(ans.nextPrice).to.deep.eq(normalized(2000));

        // case 8: decrease short position, flip the position direction
        ans = await perpTracker_.computeTrade(
            normalized(-10),
            normalized(1000),
            normalized(20),
            normalized(2000)
        );
        expect(ans.nextPrice).to.deep.eq(normalized(2000));
    });
    it("set functions", async () => {
        await perpTracker_.setMarket(ADDR0);
        expect(await perpTracker_.market()).to.eq(ADDR0);
        await perpTracker_.setSetting(ADDR0);
        expect(await perpTracker_.settings()).to.eq(ADDR0);
    });
});
