import "hardhat-deploy";
import { task, types } from "hardhat/config";
import { CONTRACTS, getTypedContract } from "../utils/utils";
import BigNumber from "bignumber.js";

task("oracle:price", "get price")
    .addParam("token", "token address", undefined, types.string, false)
    .addParam("pyth", "must use pyth or not", false, types.boolean, true)
    .setAction(async (taskArgs, hre) => {
        const { getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();

        const oracle = await getTypedContract(hre, CONTRACTS.PriceOracle, deployer);
        let price;
        if (taskArgs.pyth) {
            price = new BigNumber((await oracle.getOffchainPrice(taskArgs.token, 0)).toString())
                .dividedBy(1e18)
                .dp(2)
                .toString(10);
        } else {
            price = new BigNumber((await oracle.getPrice(taskArgs.token)).toString())
                .dividedBy(1e18)
                .dp(2)
                .toString(10);
        }
        console.log(`price: ${price}`);
    });
