import hre from "hardhat";
import { expect } from "chai";
import { CONTRACTS, getProxyContract, perpMarketKey } from "../src/utils/utils";
import { ethers } from "ethers";
import { NetworkConfigs, getConfig } from "../src/config";

describe("MarketSettings", () => {
    let marketSettings_: ethers.Contract;
    let config: NetworkConfigs;

    before(async () => {
        marketSettings_ = await getProxyContract(hre, CONTRACTS.MarketSettings);
        config = getConfig(hre.network.name);
    });

    it("getUintVal", async () => {
        // set general config
        for (const [term, rawValue] of Object.entries(
            config.marketGeneralConfig
        )) {
            const key = hre.ethers.utils.formatBytes32String(term);
            const value = await marketSettings_.getUintVals(key);
            expect(value.eq(rawValue)).to.be.eq(true);
        }
    });

    it("getUintValsByMarket", async () => {
        for (const [market, conf] of Object.entries(config.marketConfig)) {
            const token = (await hre.ethers.getContract(market)).address;
            for (const [k, v] of Object.entries(conf)) {
                const value = await marketSettings_.getUintValsByMarket(
                    perpMarketKey(token),
                    hre.ethers.utils.formatBytes32String(k)
                );
                expect(value.eq(v)).to.be.eq(true);
            }
        }
    });
});
