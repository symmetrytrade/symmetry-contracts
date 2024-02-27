import { formatEther } from "ethers";
import { task, types } from "hardhat/config";
import { getConfig } from "../config";
import { CONTRACTS, getTypedContract, mustGetKey, normalized, transact } from "../utils/utils";

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

task("oracle:update", "get price feeds").setAction(async (_taskArgs, hre) => {
    const oracle_ = await getTypedContract(hre, CONTRACTS.PriceOracle);

    // set chainlink
    const config = getConfig(hre.network.name);

    if (config.chainlink?.aggregators) {
        console.log(`set chainlink aggregators..`);
        const aggregators = config.chainlink.aggregators;
        const tokens = [];
        const addresses = [];
        for (const [token, aggregator] of Object.entries(aggregators)) {
            const key = mustGetKey(config.addresses, token);
            const curVal = await oracle_.aggregators(key);
            if (curVal !== aggregator) {
                console.log(`updating ${token}(${key}) chainlink aggregator to ${aggregator}..`);
                tokens.push(key);
                addresses.push(aggregator);
            }
        }
        if (tokens.length > 0) {
            await transact(oracle_, "setChainlinkAggregators", [tokens, addresses], false);
        }
    }

    // set pyth
    if (config.pyth?.assetIds) {
        console.log(`set pyth asset ids..`);
        const assetIds = config.pyth.assetIds;
        const tokens = [];
        const ids = [];
        for (const [token, id] of Object.entries(assetIds)) {
            const key = mustGetKey(config.addresses, token);
            const curVal = await oracle_.assetIds(key);
            if (curVal !== id) {
                console.log(`updating ${token}(${key}) pyth asset id to ${id}..`);
                tokens.push(key);
                ids.push(id);
            }
        }
        if (tokens.length > 0) {
            await transact(oracle_, "setPythIds", [tokens, ids], false);
        }
    }
});
