import { ZeroAddress } from "ethers";
import { task, types } from "hardhat/config";
import { CONTRACTS, deployDirectly } from "../utils/utils";

task("timelock:deploy", "deploy timelock contract")
    .addParam("delay", "min delay", undefined, types.int, false)
    .addParam("safe", "gnosis safe address", undefined, types.string, false)
    .setAction(async (taskArgs: { delay: number; safe: string }, hre) => {
        const { getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();

        await deployDirectly(hre, CONTRACTS.Timelock, [
            taskArgs.delay,
            [taskArgs.safe],
            [taskArgs.safe, deployer],
            ZeroAddress,
        ]);
    });
