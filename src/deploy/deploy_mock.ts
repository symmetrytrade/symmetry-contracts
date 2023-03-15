import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const { deploy } = deployments;
    // skip if exists
    if (hre.network.name !== "hardhat") {
        return;
    }

    const tokens = [
        { name: "USD Coin", symbol: "USDC" },
        { name: "Wrapped Ether", symbol: "WETH" },
        { name: "Wrapped Bitcoin", symbol: "WBTC" },
    ];
    // deploy test tokens
    for (const token of tokens) {
        await deploy(CONTRACTS[token.symbol].name, {
            from: deployer,
            contract: CONTRACTS[token.symbol].contract,
            args: [token.name, token.symbol],
            log: true,
        });
    }
    // deploy chainlink aggregators
    const aggregators = [
        { name: "Sequencer", decimals: 0 },
        { name: "USDC", decimals: 6 },
        { name: "WETH", decimals: 18 },
        { name: "WBTC", decimals: 8 },
    ];
    for (const aggregator of aggregators) {
        const name = `ChainlinkAggregator${aggregator.name}`;
        await deploy(CONTRACTS[name].name, {
            from: deployer,
            contract: CONTRACTS[name].contract,
            args: [aggregator.decimals],
            log: true,
        });
    }
    // deploy pyth
    await deploy(CONTRACTS.Pyth.name, {
        from: deployer,
        contract: CONTRACTS.Pyth.contract,
        args: [],
        log: true,
    });
};

deploy.tags = ["mock"];
export default deploy;
