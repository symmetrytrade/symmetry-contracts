import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
    CONTRACTS,
    deployInERC1967Proxy,
    getProxyContract,
} from "../utils/utils";
import { getConfig } from "../config";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    await deployInERC1967Proxy(hre, CONTRACTS.PriceOracle);

    const oracle = await getProxyContract(hre, CONTRACTS.PriceOracle);
    oracle.connect(deployer);

    // initialize
    console.log(`initializing ${CONTRACTS.PriceOracle.name}..`);
    await (await oracle.initialize()).wait();

    // set chainlink
    const config = getConfig(hre.network.name);

    if (config.chainlink?.sequencerUptimeFeed) {
        console.log(`set chainlink ${hre.network.name} uptime feed..`);
        await (
            await oracle.setChainlinkSequencerUptimeFeed(
                config.chainlink.sequencerUptimeFeed,
                config.gracePeriodTime
            )
        ).wait();
    }

    // TODO: Mock chainlink / pyth in local network

    if (config.chainlink?.aggregators) {
        console.log(`set chainlink aggregators..`);
        const aggregators = config.chainlink.aggregators;
        let tokens = [];
        let addresses = [];
        for (const [token, aggregator] of Object.entries(aggregators)) {
            tokens.push(token);
            addresses.push(aggregator);
            if (tokens.length === 5) {
                await (
                    await oracle.setChainlinkSequencerUptimeFeed(
                        tokens,
                        addresses
                    )
                ).wait();
                tokens = [];
                addresses = [];
            }
        }
        if (tokens.length > 0) {
            await (
                await oracle.setChainlinkSequencerUptimeFeed(tokens, addresses)
            ).wait();
        }
    }

    // set pyth
    if (config.pyth?.priceFeed) {
        console.log(`set pyth pricefeed..`);
        await (await oracle.setPythOracle(config.pyth.priceFeed)).wait();
    }
};

deploy.tags = [CONTRACTS.PriceOracle.name, "prod", "test"];
deploy.dependencies = [CONTRACTS.USDC.name];
export default deploy;
