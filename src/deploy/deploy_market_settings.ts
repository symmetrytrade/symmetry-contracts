import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployInBeaconProxy, getProxyContract } from "../utils/utils";
import { updateSettings } from "../tasks/settings";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    await deployInBeaconProxy(hre, CONTRACTS.MarketSettings);

    const settings_ = await getProxyContract(hre, CONTRACTS.MarketSettings, deployer);

    // initialize
    console.log(`initializing ${CONTRACTS.MarketSettings.name}..`);
    if (!(await settings_.initialized())) {
        await (await settings_.initialize()).wait();
    }

    await updateSettings(hre);
};

deploy.tags = [CONTRACTS.MarketSettings.name, "prod"];
export default deploy;
