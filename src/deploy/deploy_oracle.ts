import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
    CONTRACTS,
    deployInBeaconProxy,
    getProxyContract,
} from "../utils/utils";
import { getConfig } from "../config";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    await deployInBeaconProxy(hre, CONTRACTS.PriceOracle);

    const oracle = await getProxyContract(hre, CONTRACTS.PriceOracle);
    oracle.connect(deployer);

    // initialize
    console.log(`initializing ${CONTRACTS.PriceOracle.name}..`);
    await (await oracle.initialize()).wait();

    // set chainlink
    const config = getConfig(hre.network.name);

    const sequencerUptimeFeed = config.chainlink?.sequencerUptimeFeed
        ? config.chainlink?.sequencerUptimeFeed
        : (
              await hre.ethers.getContract(
                  CONTRACTS.ChainlinkAggregatorSequencer.name
              )
          ).address;
    console.log(`set chainlink ${hre.network.name} uptime feed..`);
    await (
        await oracle.setChainlinkSequencerUptimeFeed(
            sequencerUptimeFeed,
            config.gracePeriodTime
        )
    ).wait();

    console.log(`set chainlink aggregators..`);
    if (hre.network.name === "hardhat") {
        // local test
        const tokens = ["USDC", "WBTC", "WETH"];
        for (const token of tokens) {
            const tokenAddress = (await hre.ethers.getContract(token)).address;
            const aggregator = (
                await hre.ethers.getContract(`ChainlinkAggregator${token}`)
            ).address;
            await (
                await oracle.setChainlinkAggregators(
                    [tokenAddress],
                    [aggregator]
                )
            ).wait();
        }
    } else if (config.chainlink?.aggregators) {
        const aggregators = config.chainlink.aggregators;
        let tokens = [];
        let addresses = [];
        for (const [token, aggregator] of Object.entries(aggregators)) {
            tokens.push(token);
            addresses.push(aggregator);
            if (tokens.length === 5) {
                await (
                    await oracle.setChainlinkAggregators(tokens, addresses)
                ).wait();
                tokens = [];
                addresses = [];
            }
        }
        if (tokens.length > 0) {
            await (
                await oracle.setChainlinkAggregators(tokens, addresses)
            ).wait();
        }
    }

    // set pyth
    const pyth = config.pyth?.priceFeed
        ? config.pyth?.priceFeed
        : (await hre.ethers.getContract(`Pyth`)).address;
    console.log(`set pyth pricefeed..`);
    await (await oracle.setPythOracle(pyth)).wait();
};

deploy.tags = [CONTRACTS.PriceOracle.name, "prod"];
deploy.dependencies = ["mock"];
export default deploy;
