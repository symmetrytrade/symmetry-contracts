import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { getConfig } from "../config";
import { tokens } from "../utils/test_utils";
import { CONTRACTS, deployInBeaconProxy, getTypedContract, mustGetKey } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    await deployInBeaconProxy(hre, CONTRACTS.PriceOracle);

    const oracle_ = await getTypedContract(hre, CONTRACTS.PriceOracle);

    // initialize
    const marketSettings_ = await getTypedContract(hre, CONTRACTS.MarketSettings);
    console.log(`initializing ${CONTRACTS.PriceOracle.name}..`);
    if (!(await oracle_.initialized())) {
        await (await oracle_.initialize(marketSettings_)).wait();
    }

    // set chainlink
    const config = getConfig(hre.network.name);

    const sequencerUptimeFeed_ =
        config.chainlink?.sequencerUptimeFeed ?? (await getTypedContract(hre, CONTRACTS.ChainlinkAggregatorSequencer));
    console.log(`set chainlink ${hre.network.name} uptime feed..`);
    await (await oracle_.setChainlinkSequencerUptimeFeed(sequencerUptimeFeed_, config.gracePeriodTime)).wait();

    console.log(`set chainlink aggregators..`);
    if (hre.network.name === "hardhat") {
        for (const token of tokens) {
            const token_ = await hre.ethers.getContract(token.symbol);
            const aggregator_ = await hre.ethers.getContract(`ChainlinkAggregator${token.symbol}`);
            await (await oracle_.setChainlinkAggregators([token_], [aggregator_])).wait();
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
    const pyth_ = config.pyth?.priceFeed ?? (await getTypedContract(hre, CONTRACTS.Pyth));
    console.log(`set pyth pricefeed..`);
    await (await oracle_.setPythOracle(pyth_)).wait();

    console.log(`set pyth asset ids..`);
    if (hre.network.name === "hardhat") {
        for (const token of tokens) {
            const token_ = await hre.ethers.getContract(token.symbol);
            await (await oracle_.setPythIds([token_], [token.pythId])).wait();
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
