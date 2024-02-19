import { formatEther } from "ethers";
import "hardhat-deploy";
import { task, types } from "hardhat/config";
import { CONTRACTS, getTypedContract, normalized } from "../utils/utils";

task("oracle:price", "get price")
    .addParam("token", "token address", undefined, types.string, false)
    .addParam("pyth", "must use pyth or not", false, types.boolean, true)
    .setAction(async (taskArgs: { token: string; pyth: boolean }, hre) => {
        const PRECISION = normalized("0.01");
        const oracle = await getTypedContract(hre, CONTRACTS.PriceOracle);
        let price;
        if (taskArgs.pyth) {
            price = ((await oracle.getOffchainPrice(taskArgs.token, 0)) / PRECISION) * PRECISION;
        } else {
            price = ((await oracle.getPrice(taskArgs.token)) / PRECISION) * PRECISION;
        }
        console.log(`price: ${formatEther(price)}`);
    });
