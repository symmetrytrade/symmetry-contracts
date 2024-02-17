import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployDirectly, getTypedContract, normalized } from "../utils/utils";
import { chainlinkAggregators, tokens } from "../utils/test_utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    // skip if exists
    if (hre.network.name !== "hardhat") {
        return;
    }

    // deploy test tokens
    for (const token of tokens) {
        const decimals = token.symbol === "USDC" ? 6 : 18;
        await deployDirectly(hre, CONTRACTS[token.symbol], [token.name, token.symbol, decimals]);
        const faucetToken = await getTypedContract(hre, CONTRACTS[token.symbol]);
        await (await faucetToken.mint(deployer, normalized(1e18))).wait();
    }
    // deploy chainlink aggregators
    for (const aggregator of chainlinkAggregators) {
        const name = `ChainlinkAggregator${aggregator.name}` as keyof typeof CONTRACTS;
        await deployDirectly(hre, CONTRACTS[name], [aggregator.decimals]);
    }
    // deploy pyth
    await deployDirectly(hre, CONTRACTS.Pyth);
};

deploy.tags = ["mock"];
export default deploy;
