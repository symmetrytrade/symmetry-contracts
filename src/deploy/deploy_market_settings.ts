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

    await deployInBeaconProxy(hre, CONTRACTS.MarketSettings);

    const settings = await getProxyContract(hre, CONTRACTS.MarketSettings);
    settings.connect(deployer);

    // initialize
    console.log(`initializing ${CONTRACTS.MarketSettings.name}..`);
    await (await settings.initialize()).wait();

    // set uint values
    const config = getConfig(hre.network.name);
    for (const [term, rawValue] of Object.entries(config.marketConfig)) {
        const key = hre.ethers.utils.formatBytes32String(term);
        const value = hre.ethers.BigNumber.from(rawValue);
        await (await settings.setUintVals(key, value)).wait();
    }
};

deploy.tags = [CONTRACTS.MarketSettings.name, "prod", "test"];
export default deploy;
