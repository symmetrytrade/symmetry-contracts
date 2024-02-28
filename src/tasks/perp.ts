import { task, types } from "hardhat/config";
import { getConfig } from "../config";
import { CONTRACTS, getTypedContract, mustGetKey, transact } from "../utils/utils";

task("perp:add", "add perpetual trading pair")
    .addParam("name", "token name", undefined, types.string, false)
    .setAction(async (taskArgs: { name: string }, hre) => {
        const config = getConfig(hre.network.name);
        const perpTracker_ = await getTypedContract(hre, CONTRACTS.PerpTracker);
        const token = mustGetKey(config.addresses, taskArgs.name);
        await transact(perpTracker_, "addMarketToken", [token], false);
    });
