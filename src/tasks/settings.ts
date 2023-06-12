import "hardhat-deploy";
import "@nomiclabs/hardhat-ethers";
import { task } from "hardhat/config";
import { CONTRACTS, getProxyContract, mustGetKey, perpConfigKey } from "../utils/utils";
import { getConfig } from "../config";

task("settings:update", "update settings").setAction(async (taskArgs, hre) => {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    const settings_ = await getProxyContract(hre, CONTRACTS.MarketSettings, deployer);

    // set general config
    const config = getConfig(hre.network.name);
    for (const [term, rawValue] of Object.entries(config.marketGeneralConfig)) {
        const key = hre.ethers.utils.formatBytes32String(term);
        const value = hre.ethers.BigNumber.from(rawValue);
        const curVal = await settings_.getIntVals(key);
        if (!curVal.eq(value)) {
            console.log(`updating ${term} to ${value.toString()}`);
            await (await settings_.setIntVals(key, value)).wait();
        }
    }
    // set market specific config
    for (const [market, conf] of Object.entries(config.marketConfig)) {
        const token = mustGetKey(config.addresses, market);
        for (const [k, v] of Object.entries(conf)) {
            const key = perpConfigKey(token, k);
            const value = hre.ethers.BigNumber.from(v);
            const curVal = await settings_.getIntVals(key);
            if (!curVal.eq(value)) {
                console.log(`updating ${k} of ${market} market to ${value.toString()}`);
                await (await settings_.setIntVals(key, value)).wait();
            }
        }
    }
});
