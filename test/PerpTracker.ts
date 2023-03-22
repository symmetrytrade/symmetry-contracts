import hre, { deployments } from "hardhat";
import { expect } from "chai";
import { CONTRACTS, getProxyContract, perpMarketKey } from "../src/utils/utils";
import { ethers } from "ethers";

describe("PerpTracker", () => {
    let PerpTracker_: ethers.Contract;
    let WETH: string;
    let WBTC: string;

    before(async () => {
        await deployments.fixture();
        const { deployer } = await hre.getNamedAccounts();
        PerpTracker_ = await getProxyContract(
            hre,
            CONTRACTS.PerpTracker,
            deployer
        );
        WETH = (await hre.ethers.getContract("WETH")).address;
        WBTC = (await hre.ethers.getContract("WBTC")).address;
    });

    it("market key", async () => {
        const marketKey = await PerpTracker_.marketKey(WETH);
        expect(marketKey).to.be.eq(perpMarketKey(WETH));
    });

    it("listed tokens", async () => {
        const tokenLength = await PerpTracker_.marketTokensLength();
        expect(tokenLength.eq(2)).to.be.eq(true);
        expect(await PerpTracker_.marketTokensList(0)).to.be.eq(WBTC);
        expect(await PerpTracker_.marketTokensList(1)).to.be.eq(WETH);
    });

    it("remove tokens", async () => {
        await expect(PerpTracker_.removeToken(2)).to.be.revertedWith(
            "PerpTracker: token index out of bound"
        );

        await (await PerpTracker_.removeToken(0)).wait();
        const tokenLength = await PerpTracker_.marketTokensLength();
        expect(tokenLength.eq(1)).to.be.eq(true);
        expect(await PerpTracker_.marketTokensList(0)).to.be.eq(WETH);
    });
});
