import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
    CONTRACTS,
    deployInERC1967Proxy,
    getProxyContract,
} from "../utils/utils";
import { GlobalConfig } from "../config";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const config =
        hre.network.name in GlobalConfig ? GlobalConfig[hre.network.name] : {};

    await deployInERC1967Proxy(hre, CONTRACTS.Market);

    const market = await getProxyContract(hre, CONTRACTS.Market);
    market.connect(deployer);

    // initialize
    console.log(`initializing ${CONTRACTS.Market.name}..`);
    const baseToken = config.addresses?.USDC
        ? config.addresses.USDC
        : (await hre.ethers.getContract(CONTRACTS.USDC.name)).address;
    const priceOracle = (
        await hre.ethers.getContract(CONTRACTS.PriceOracle.name)
    ).address;
    const marketSettigs = (
        await hre.ethers.getContract(CONTRACTS.MarketSettings.name)
    ).address;
    await (
        await market.initialize(baseToken, priceOracle, marketSettigs)
    ).wait();
};

deploy.tags = [CONTRACTS.Market.name, "prod", "test"];
deploy.dependencies = [
    CONTRACTS.PriceOracle.name,
    CONTRACTS.MarketSettings.name,
    CONTRACTS.USDC.name,
];
export default deploy;
