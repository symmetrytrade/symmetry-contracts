import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployInBeaconProxy, getTypedContract, mustGetKey } from "../utils/utils";
import { getConfig } from "../config";
import { tokens } from "../utils/test_utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    await deployInBeaconProxy(hre, CONTRACTS.PriceOracle);

    const oracle_ = await getTypedContract(hre, CONTRACTS.PriceOracle);

    // initialize
    const marketSettings = await (await getTypedContract(hre, CONTRACTS.MarketSettings)).getAddress();
    console.log(`initializing ${CONTRACTS.PriceOracle.name}..`);
    if (!(await oracle_.initialized())) {
        await (await oracle_.initialize(marketSettings)).wait();
    }

    // set chainlink
    const config = getConfig(hre.network.name);

    const sequencerUptimeFeed = config.chainlink?.sequencerUptimeFeed
        ? config.chainlink?.sequencerUptimeFeed
        : await (await getTypedContract(hre, CONTRACTS.ChainlinkAggregatorSequencer)).getAddress();
    console.log(`set chainlink ${hre.network.name} uptime feed..`);
    await (await oracle_.setChainlinkSequencerUptimeFeed(sequencerUptimeFeed, config.gracePeriodTime)).wait();

    console.log(`set chainlink aggregators..`);
    if (hre.network.name === "hardhat") {
        for (const token of tokens) {
            const tokenAddress = await (await hre.ethers.getContract(token.symbol)).getAddress();
            const aggregator = await (await hre.ethers.getContract(`ChainlinkAggregator${token.symbol}`)).getAddress();
            await (await oracle_.setChainlinkAggregators([tokenAddress], [aggregator])).wait();
        }
    } else if (config.chainlink?.aggregators) {
        const aggregators = config.chainlink.aggregators;
        let tokens = [];
        let addresses = [];
        for (const [token, aggregator] of Object.entries(aggregators)) {
            tokens.push(mustGetKey(config.addresses, token));
            addresses.push(aggregator);
            if (tokens.length === 5) {
                await (await oracle_.setChainlinkAggregators(tokens, addresses)).wait();
                tokens = [];
                addresses = [];
            }
        }
        if (tokens.length > 0) {
            await (await oracle_.setChainlinkAggregators(tokens, addresses)).wait();
        }
    }

    // set pyth
    const pyth = config.pyth?.priceFeed
        ? config.pyth?.priceFeed
        : await (await getTypedContract(hre, CONTRACTS.Pyth)).getAddress();
    console.log(`set pyth pricefeed..`);
    await (await oracle_.setPythOracle(pyth)).wait();

    console.log(`set pyth asset ids..`);
    if (hre.network.name === "hardhat") {
        for (const token of tokens) {
            const tokenAddress = await (await hre.ethers.getContract(token.symbol)).getAddress();
            await (await oracle_.setPythIds([tokenAddress], [token.pythId])).wait();
        }
    } else if (config.pyth?.assetIds) {
        const assetIds = config.pyth.assetIds;
        let tokens = [];
        let ids = [];
        for (const [token, id] of Object.entries(assetIds)) {
            tokens.push(mustGetKey(config.addresses, token));
            ids.push(id);
            if (tokens.length === 5) {
                await (await oracle_.setPythIds(tokens, ids)).wait();
                tokens = [];
                ids = [];
            }
        }
        if (tokens.length > 0) {
            await (await oracle_.setPythIds(tokens, ids)).wait();
            tokens = [];
            ids = [];
        }
    }
};

deploy.tags = [CONTRACTS.PriceOracle.name, "prod"];
deploy.dependencies = ["mock", CONTRACTS.MarketSettings.name];
export default deploy;
