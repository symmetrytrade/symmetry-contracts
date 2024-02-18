import { task, types } from "hardhat/config";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { getConfig } from "../config";
import { CONTRACTS, getTypedContract, marginConfigKey, mustGetKey, perpConfigKey, transact } from "../utils/utils";

export async function updateSettings(hre: HardhatRuntimeEnvironment, execute = true) {
    const settings_ = await getTypedContract(hre, CONTRACTS.MarketSettings);

    let keys = [];
    let values = [];
    // set general config
    const config = getConfig(hre.network.name);
    for (const [term, rawValue] of Object.entries(config.marketGeneralConfig)) {
        const key = hre.ethers.encodeBytes32String(term);
        type ValueType = (typeof config.marketGeneralConfig)[keyof typeof config.marketGeneralConfig];
        const value = BigInt(rawValue as ValueType);
        const curVal = await settings_.getIntVals(key);
        if (curVal !== value) {
            console.log(`updating ${term} to ${value.toString()}`);
            keys.push(key);
            values.push(value);
            if (keys.length >= 50) {
                await transact(settings_, "setIntVals", [keys, values], execute);
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
                : await (await hre.ethers.getContract(market)).getAddress();
        for (const [k, v] of Object.entries(conf)) {
            const key = perpConfigKey(token, k);
            type ValueType = (typeof conf)[keyof typeof conf];
            const value = BigInt(v as ValueType);
            const curVal = await settings_.getIntVals(key);
            if (curVal !== value) {
                console.log(`updating ${k} of ${market} market to ${value.toString()}`);
                keys.push(key);
                values.push(value);
                if (keys.length >= 50) {
                    await transact(settings_, "setIntVals", [keys, values], execute);
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
                : await (await hre.ethers.getContract(collateral)).getAddress();
        for (const [k, v] of Object.entries(conf)) {
            const key = marginConfigKey(token, k);
            type ValueType = (typeof conf)[keyof typeof conf];
            const value = BigInt(v as ValueType);
            const curVal = await settings_.getIntVals(key);
            if (curVal !== value) {
                console.log(`updating ${k} of ${collateral} collateral to ${value.toString()}`);
                keys.push(key);
                values.push(value);
                if (keys.length >= 50) {
                    await transact(settings_, "setIntVals", [keys, values], execute);
                    keys = [];
                    values = [];
                }
            }
        }
    }
    if (keys.length > 0) {
        await transact(settings_, "setIntVals", [keys, values], execute);
    }
}

task("settings:update", "update settings")
    .addParam("execute", "send transaction or not", false, types.boolean, true)
    .setAction(async (taskArgs: { execute: boolean }, hre) => {
        await updateSettings(hre, taskArgs.execute);
    });
