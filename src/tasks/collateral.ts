import { task, types } from "hardhat/config";
import { getConfig } from "../config";
import { CONTRACTS, getTypedContract, mustGetKey } from "../utils/utils";

task("collateral:add", "add collateral")
    .addParam("collateral", "token name", undefined, types.string, false)
    .setAction(async (taskArgs: { collateral: string }, hre) => {
        const config = getConfig(hre.network.name);
        const marginTracker_ = await getTypedContract(hre, CONTRACTS.MarginTracker);
        const token = mustGetKey(config.addresses, taskArgs.collateral);
        await (await marginTracker_.addCollateralToken(token)).wait();
    });
