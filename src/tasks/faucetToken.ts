import { task, types } from "hardhat/config";

task("faucet:deploy", "deploy faucet token")
    .addParam("name", "token name", undefined, types.string, false)
    .addParam("symbol", "token symbol", undefined, types.string, false)
    .addParam("decimals", "token decimals", 18, types.int, true)
    .setAction(async (taskArgs: { name: string; symbol: string; decimals: number }, hre) => {
        const { deployments, getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();

        const contract = taskArgs.symbol === "WETH" ? "FaucetWETH" : "FaucetToken";
        await deployments.deploy(taskArgs.symbol, {
            from: deployer,
            contract: contract,
            args: [taskArgs.name, taskArgs.symbol, taskArgs.decimals],
            log: true,
        });
    });
