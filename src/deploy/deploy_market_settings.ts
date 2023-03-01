import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
    CONTRACTS,
    deployInERC1967Proxy,
    getProxyContract,
} from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    await deployInERC1967Proxy(hre, CONTRACTS.MarketSettings);

    const settings = await getProxyContract(hre, CONTRACTS.MarketSettings);
    settings.connect(deployer);

    // initialize
    console.log(`initializing ${CONTRACTS.MarketSettings.name}..`);
    await (await settings.initialize()).wait();
};

deploy.tags = [CONTRACTS.MarketSettings.name, "prod", "test"];
export default deploy;
