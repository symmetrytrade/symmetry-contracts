import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
    CONTRACTS,
    deployInBeaconProxy,
    getProxyContract,
} from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    await deployInBeaconProxy(hre, CONTRACTS.LPToken);

    const lpToken_ = await getProxyContract(hre, CONTRACTS.LPToken, deployer);

    // initialize
    console.log(`initializing ${CONTRACTS.LPToken.name}..`);
    await (await lpToken_.initialize("LPToken", "LP", 18)).wait();
};

deploy.tags = [CONTRACTS.LPToken.name, "prod"];
export default deploy;
