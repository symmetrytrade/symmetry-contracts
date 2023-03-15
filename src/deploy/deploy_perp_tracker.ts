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

    await deployInBeaconProxy(hre, CONTRACTS.PerpTracker);

    const perpTracker = await getProxyContract(hre, CONTRACTS.PerpTracker);
    perpTracker.connect(deployer);

    // initialize
    console.log(`initializing ${CONTRACTS.PerpTracker.name}..`);
    const market = await getProxyContract(hre, CONTRACTS.Market);
    await (await perpTracker.initialize(market.address)).wait();
};

deploy.tags = [CONTRACTS.PerpTracker.name, "prod"];
deploy.dependencies = [CONTRACTS.Market.name];
export default deploy;
