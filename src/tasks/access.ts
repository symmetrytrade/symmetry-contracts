import "hardhat-deploy";
import { task, types } from "hardhat/config";
import { CONTRACTS, DEFAULT_ADMIN_ROLE, PAUSER_ROLE, getTypedContract, validateError } from "../utils/utils";
import { HardhatRuntimeEnvironment } from "hardhat/types";

export async function getProxyInfo(hre: HardhatRuntimeEnvironment) {
    const proxied = new Set();
    const contracts = Object.keys(CONTRACTS);
    for (const key of contracts) {
        const name = CONTRACTS[key].name;
        try {
            await hre.ethers.getContract(`${name}Beacon`);
            proxied.add(name);
        } catch (e) {
            validateError(e, "No Contract deployed with name");
        }
    }
    return proxied;
}

task("access:upgrade", "transfer beacon ownership to timelock")
    .addParam("timelock", "timelock address", undefined, types.string, false)
    .setAction(async (taskArgs, hre) => {
        const { getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();
        const proxied = await getProxyInfo(hre);
        for (const name of Array.from(proxied)) {
            const beacon = await hre.ethers.getContract(`${name}Beacon`, deployer);
            if ((await beacon.owner()) == deployer) {
                console.log(`transfer ownership of ${name}Beacon..`);
                await (await beacon.transferOwnership(taskArgs.timelock)).wait();
            }
        }
    });

task("access:admin", "grant default admin role to timelock")
    .addParam("timelock", "timelock address", undefined, types.string, false)
    .setAction(async (taskArgs, hre) => {
        const { getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();
        const proxied = await getProxyInfo(hre);
        const contracts = Object.keys(CONTRACTS);
        for (const key of contracts) {
            const name = CONTRACTS[key].name;
            let contract;
            if (proxied.has(name)) {
                contract = await getTypedContract(hre, CONTRACTS[key], deployer);
            } else {
                try {
                    contract = await hre.ethers.getContract(name, deployer);
                } catch (e) {
                    validateError(e, "No Contract deployed with name");
                    continue;
                }
            }
            try {
                contract.interface.getFunction("DEFAULT_ADMIN_ROLE");
            } catch (e) {
                validateError(e, "no matching function");
                continue;
            }
            if (await contract.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
                console.log(`granting default admin role of ${name} to timelock..`);
                await (await contract.grantRole(DEFAULT_ADMIN_ROLE, taskArgs.timelock)).wait();
            } else {
                console.log(`deployer does not have default admin role of ${name}, skip.`);
            }
        }
    });

task("access:pauser", "grant pauser role to multisig")
    .addParam("multisig", "multisig address", undefined, types.string, false)
    .setAction(async (taskArgs, hre) => {
        const { getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();
        const proxied = await getProxyInfo(hre);
        const contracts = Object.keys(CONTRACTS);
        for (const key of contracts) {
            const name = CONTRACTS[key].name;
            let contract;
            if (proxied.has(name)) {
                contract = await getTypedContract(hre, CONTRACTS[key], deployer);
            } else {
                try {
                    contract = await hre.ethers.getContract(name, deployer);
                } catch (e) {
                    validateError(e, "No Contract deployed with name");
                    continue;
                }
            }
            try {
                contract.interface.getFunction("PAUSER_ROLE");
            } catch (e) {
                validateError(e, "no matching function");
                continue;
            }
            if (await contract.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
                console.log(`granting pauser role of ${name} to multisig..`);
                await (await contract.grantRole(PAUSER_ROLE, taskArgs.multisig)).wait();
            } else {
                console.log(`deployer does not have default admin role of ${name}, skip.`);
            }
        }
    });

task("revoke:admin", "revoke admin role").setAction(async (taskArgs, hre) => {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const proxied = await getProxyInfo(hre);
    const contracts = Object.keys(CONTRACTS);
    for (const key of contracts) {
        const name = CONTRACTS[key].name;
        let contract;
        if (proxied.has(name)) {
            contract = await getTypedContract(hre, CONTRACTS[key], deployer);
        } else {
            try {
                contract = await hre.ethers.getContract(name, deployer);
            } catch (e) {
                validateError(e, "No Contract deployed with name");
                continue;
            }
        }
        try {
            contract.interface.getFunction("DEFAULT_ADMIN_ROLE");
        } catch (e) {
            validateError(e, "no matching function");
            continue;
        }
        if (await contract.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
            if ((await contract.getRoleMemberCount(DEFAULT_ADMIN_ROLE)) == 1) {
                console.log(`deployer is the only admin of ${name}, skip.`);
                continue;
            }
            console.log(`renouncing deployer's default admin role of ${name}..`);
            await (await contract.renounceRole(DEFAULT_ADMIN_ROLE, deployer)).wait();
        } else {
            console.log(`deployer does not have default admin role of ${name}, skip.`);
        }
    }
});
