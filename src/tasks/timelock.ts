import "hardhat-deploy";
import { task, types } from "hardhat/config";
import { ADDR0, CONTRACTS } from "../utils/utils";

task("timelock:deploy", "deploy timelock contract")
    .addParam("delay", "min delay", undefined, types.int, false)
    .addParam("safe", "gnosis safe address", undefined, types.string, false)
    .setAction(async (taskArgs, hre) => {
        const { deployments, getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();
        const { deploy } = deployments;

        await deploy(CONTRACTS.Timelock.name, {
            from: deployer,
            contract: CONTRACTS.Timelock.contract,
            args: [taskArgs.delay, [taskArgs.safe], [taskArgs.safe, deployer], ADDR0],
            log: true,
        });
    });
