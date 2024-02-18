import { expect } from "chai";
import hre, { deployments } from "hardhat";
import { getConfig, NetworkConfigs } from "../src/config";
import { CONTRACTS, getTypedContract, perpDomainKey } from "../src/utils/utils";
import { MarketSettings } from "../typechain-types";

describe("MarketSettings", () => {
    let marketSettings_: MarketSettings;
    let config: NetworkConfigs;

    before(async () => {
        await deployments.fixture();
        const account1 = (await hre.ethers.getSigners())[1];
        marketSettings_ = await getTypedContract(hre, CONTRACTS.MarketSettings, account1);
        config = getConfig(hre.network.name);
    });

    it("getUintVal", async () => {
        // set general config
        for (const [term, rawValue] of Object.entries(config.marketGeneralConfig)) {
            const key = hre.ethers.encodeBytes32String(term);
            const value = await marketSettings_.getIntVals(key);
            expect(value).to.eq(rawValue);
        }
    });

    it("getIntValsByDomain", async () => {
        for (const [market, conf] of Object.entries(config.marketConfig)) {
            const token = await (await hre.ethers.getContract(market)).getAddress();
            for (const [k, v] of Object.entries(conf)) {
                const value = await marketSettings_.getIntValsByDomain(
                    perpDomainKey(token),
                    hre.ethers.encodeBytes32String(k)
                );
                expect(value).to.eq(v);
            }
        }
    });
});
