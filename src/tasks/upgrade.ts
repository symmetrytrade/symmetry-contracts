import "hardhat-deploy";
import "@nomiclabs/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";
import { task, types } from "hardhat/config";

task("upgrade", "upgrade contract")
    .addParam(
        "proxyName",
        "name of the proxy contract",
        undefined,
        types.string,
        false
    )
    .addParam(
        "implArtifact",
        "name of the implementation contract",
        undefined,
        types.string,
        false
    )
    .addParam(
        "execute",
        "settle transaction on chain",
        false,
        types.boolean,
        true
    )
    .setAction(async (taskArgs, hre) => {
        const { deployer } = await hre.getNamedAccounts();
        const beacon = await hre.ethers.getContract(
            `${taskArgs.proxyName}Beacon`,
            deployer
        );
        const newImpl = await hre.ethers.getContractFactory(
            taskArgs.implArtifact
        );
        await hre.upgrades.validateUpgrade(beacon.address, newImpl);

        if (taskArgs.execute) {
            // settle on chain
            await (await beacon.upgradeTo(newImpl)).wait();
        } else {
            console.log("data:");
            console.log(
                beacon.interface.encodeFunctionData("upgradeTo", [newImpl])
            );
        }
    });
