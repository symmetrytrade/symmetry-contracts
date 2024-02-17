import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { updateSettings } from "../tasks/settings";
import { CONTRACTS, deployInBeaconProxy, getTypedContract } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    await deployInBeaconProxy(hre, CONTRACTS.MarketSettings);

    const settings_ = await getTypedContract(hre, CONTRACTS.MarketSettings);

    // initialize
    console.log(`initializing ${CONTRACTS.MarketSettings.name}..`);
    if (!(await settings_.initialized())) {
        await (await settings_.initialize()).wait();
    }

    await updateSettings(hre);
};

deploy.tags = [CONTRACTS.MarketSettings.name, "prod"];
export default deploy;
