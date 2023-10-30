import "hardhat-deploy";
import "@nomiclabs/hardhat-ethers";
import { task, types } from "hardhat/config";

task("faucet:deploy", "deploy faucet token")
    .addParam("name", "token name", undefined, types.string, false)
    .addParam("symbol", "token symbol", undefined, types.string, false)
    .addParam("decimals", "token decimals", 18, types.int, true)
    .setAction(async (taskArgs, hre) => {
        const { deployments, getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();
        const { deploy } = deployments;

        await deploy(taskArgs.symbol, {
            from: deployer,
            contract: "FaucetToken",
            args: [taskArgs.name, taskArgs.symbol, taskArgs.decimals],
            log: true,
        });
    });
