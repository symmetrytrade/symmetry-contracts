import "hardhat-deploy";
import "@nomiclabs/hardhat-ethers";
import { task, types } from "hardhat/config";
import { CONTRACTS, getProxyContract, mustGetKey } from "../utils/utils";
import { getConfig } from "../config";

task("collateral:add", "add collateral")
    .addParam("collateral", "token name", undefined, types.string, false)
    .setAction(async (taskArgs, hre) => {
        const { getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();
        const config = getConfig(hre.network.name);
        const marginTracker_ = await getProxyContract(hre, CONTRACTS.MarginTracker, deployer);
        const token = mustGetKey(config.addresses, taskArgs.collateral);
        await (await marginTracker_.addCollateralToken(token)).wait();
    });
