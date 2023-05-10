import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS } from "../utils/utils";
import { chainlinkAggregators, tokens } from "../utils/test_utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const { deploy } = deployments;
    // skip if exists
    if (hre.network.name !== "hardhat") {
        return;
    }

    // deploy test tokens
    for (const token of tokens) {
        await deploy(CONTRACTS[token.symbol].name, {
            from: deployer,
            contract: CONTRACTS[token.symbol].contract,
            args: [token.name, token.symbol, 18],
            log: true,
        });
        const faucetToken = await hre.ethers.getContract(
            CONTRACTS[token.symbol].name,
            deployer
        );
        await (
            await faucetToken.mint(
                deployer,
                hre.ethers.BigNumber.from("10000000000000000000000000000")
            )
        ).wait();
    }
    // deploy chainlink aggregators
    for (const aggregator of chainlinkAggregators) {
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
