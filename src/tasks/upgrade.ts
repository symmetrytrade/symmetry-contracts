import "hardhat-deploy";
import "@nomiclabs/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";
import { task, types } from "hardhat/config";
import { getProxyInfo } from "./access";
import { validateError } from "../utils/utils";

task("upgrade", "upgrade contract")
    .addParam("name", "name of the proxy contract", undefined, types.string, false)
    .addParam("artifact", "name of the implementation contract", undefined, types.string, false)
    .addParam("execute", "settle transaction on chain", false, types.boolean, true)
    .setAction(async (taskArgs, hre) => {
        const { deployments, getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();
        const { deploy } = deployments;
        const beacon = await hre.ethers.getContract(`${taskArgs.name}Beacon`, deployer);

        /*
        const newImpl = await hre.ethers.getContractFactory(taskArgs.artifact);
        await hre.upgrades.validateUpgrade(beacon.address, newImpl, {
            unsafeAllow: ["constructor"],
        });
        */

        const result = await deploy(`${taskArgs.name}Impl`, {
            from: deployer,
            contract: taskArgs.artifact,
            args: [],
            log: true,
        });
        console.log(`new implementation deployed: ${result.address}`);

        if (taskArgs.execute) {
            // settle on chain
            await (await beacon.upgradeTo(result.address)).wait();
        } else {
            console.log(`to: ${beacon.address}`);
            console.log(`data: ${beacon.interface.encodeFunctionData("upgradeTo", [result.address])}`);
        }
    });

task("upgrade:validate", "validate upgrade")
    .addParam("old", "name of the old contract", undefined, types.string, false)
    .addParam("new", "name of the new contract", undefined, types.string, false)
    .setAction(async (taskArgs, hre) => {
        const oldAddr = (await hre.ethers.getContract(`${taskArgs.old}Impl`)).address;
        const newImpl = await hre.ethers.getContractFactory(taskArgs.new);
        await hre.upgrades.validateUpgrade(oldAddr, newImpl, {
            unsafeAllow: ["constructor"],
            kind: "beacon",
        });
    });

task("upgrade:forceImport", "import contracts")
    .addParam("name", "name of the contract", undefined, types.string, false)
    .setAction(async (taskArgs, hre) => {
        const addr = (await hre.ethers.getContract(`${taskArgs.name}Impl`)).address;
        const factory = await hre.ethers.getContractFactory(taskArgs.name);
        await hre.upgrades.forceImport(addr, factory, { kind: "beacon" });
    });

task("upgrade:forceImportAll", "import contracts").setAction(async (_taskArgs, hre) => {
    const proxied = await getProxyInfo(hre);
    for (const name of Array.from(proxied)) {
        const addr = (await hre.ethers.getContract(`${name}Impl`)).address;
        const factory = await hre.ethers.getContractFactory(`${name}`);
        try {
            await hre.upgrades.forceImport(addr, factory, { kind: "beacon" });
            console.log(`force imported ${name}.`);
        } catch (e) {
            validateError(e, "The following deployment clashes with an existing one at");
            console.log(`${name} already imported.`);
        }
    }
});
