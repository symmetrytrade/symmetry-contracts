import "hardhat-deploy";
import "@nomiclabs/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";
import { task, types } from "hardhat/config";

task("upgrade", "upgrade contract")
    .addParam("name", "name of the proxy contract", undefined, types.string, false)
    .addParam("artifact", "name of the implementation contract", undefined, types.string, false)
    .addParam("execute", "settle transaction on chain", false, types.boolean, true)
    .setAction(async (taskArgs, hre) => {
        const { deployments, getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();
        const { deploy } = deployments;
        const beacon = await hre.ethers.getContract(`${taskArgs.name}Beacon`, deployer);
        //const newImpl = await hre.ethers.getContractFactory(taskArgs.artifact);

        /*
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
            console.log("data:");
            console.log(beacon.interface.encodeFunctionData("upgradeTo", [result.address]));
        }
    });
