import hre, { deployments } from "hardhat";
import { expect } from "chai";
import { CONTRACTS, getProxyContract, perpMarketKey } from "../src/utils/utils";
import { ethers } from "ethers";
import { NetworkConfigs, getConfig } from "../src/config";

describe("MarketSettings", () => {
    let marketSettings_: ethers.Contract;
    let config: NetworkConfigs;

    before(async () => {
        await deployments.fixture();
        const account1 = (await hre.ethers.getSigners())[1];
        marketSettings_ = await getProxyContract(
            hre,
            CONTRACTS.MarketSettings,
            account1
        );
        config = getConfig(hre.network.name);
    });

    it("getUintVal", async () => {
        // set general config
        for (const [term, rawValue] of Object.entries(
            config.marketGeneralConfig
        )) {
            const key = hre.ethers.utils.formatBytes32String(term);
            const value = await marketSettings_.getUintVals(key);
            expect(value).to.deep.eq(rawValue);
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
                expect(value).to.deep.eq(v);
            }
        }
    });
});
