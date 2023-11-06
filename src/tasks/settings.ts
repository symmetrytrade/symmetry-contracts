import "hardhat-deploy";
import "@nomiclabs/hardhat-ethers";
import { task } from "hardhat/config";
import { CONTRACTS, getProxyContract, marginConfigKey, mustGetKey, perpConfigKey } from "../utils/utils";
import { getConfig } from "../config";
import { HardhatRuntimeEnvironment } from "hardhat/types";

export async function updateSettings(hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    const settings_ = await getProxyContract(hre, CONTRACTS.MarketSettings, deployer);

    let keys = [];
    let values = [];
    // set general config
    const config = getConfig(hre.network.name);
    for (const [term, rawValue] of Object.entries(config.marketGeneralConfig)) {
        const key = hre.ethers.utils.formatBytes32String(term);
        const value = hre.ethers.BigNumber.from(rawValue);
        const curVal = await settings_.getIntVals(key);
        if (!curVal.eq(value)) {
            console.log(`updating ${term} to ${value.toString()}`);
            keys.push(key);
            values.push(value);
            if (keys.length >= 50) {
                await (await settings_.setIntVals(keys, values)).wait();
                keys = [];
                values = [];
            }
        }
    }
    // set market specific config
    for (const [market, conf] of Object.entries(config.marketConfig)) {
        const token =
            hre.network.name !== "hardhat"
                ? mustGetKey(config.addresses, market)
                : (await hre.ethers.getContract(market)).address;
        for (const [k, v] of Object.entries(conf)) {
            const key = perpConfigKey(token, k);
            const value = hre.ethers.BigNumber.from(v);
            const curVal = await settings_.getIntVals(key);
            if (!curVal.eq(value)) {
                console.log(`updating ${k} of ${market} market to ${value.toString()}`);
                keys.push(key);
                values.push(value);
                if (keys.length >= 50) {
                    await (await settings_.setIntVals(keys, values)).wait();
                    keys = [];
                    values = [];
                }
            }
        }
    }

    // set multi-collateral config
    for (const [collateral, conf] of Object.entries(config.marginConfig)) {
        const token =
            hre.network.name !== "hardhat"
                ? mustGetKey(config.addresses, collateral)
                : (await hre.ethers.getContract(collateral)).address;
        for (const [k, v] of Object.entries(conf)) {
            const key = marginConfigKey(token, k);
            const value = hre.ethers.BigNumber.from(v);
            const curVal = await settings_.getIntVals(key);
            if (!curVal.eq(value)) {
                console.log(`updating ${k} of ${collateral} collateral to ${value.toString()}`);
                keys.push(key);
                values.push(value);
                if (keys.length >= 50) {
                    await (await settings_.setIntVals(keys, values)).wait();
                    keys = [];
                    values = [];
                }
            }
        }
    }
    if (keys.length > 0) {
        await (await settings_.setIntVals(keys, values)).wait();
    }
}

task("settings:update", "update settings").setAction(async (_taskArgs, hre) => {
    await updateSettings(hre);
});
