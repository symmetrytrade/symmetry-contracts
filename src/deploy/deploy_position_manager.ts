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

    await deployInBeaconProxy(hre, CONTRACTS.PositionManager);

    const positionManager = await getProxyContract(
        hre,
        CONTRACTS.PositionManager
    );
    positionManager.connect(deployer);

    // initialize
    console.log(`initializing ${CONTRACTS.PositionManager.name}..`);
    const market = await getProxyContract(hre, CONTRACTS.Market);
    await (await positionManager.initialize(market.address)).wait();

    // add operator
    console.log(`adding operator role for PositionManager to market..`);
    market.connect(deployer);
    await (await market.setOperator(positionManager.address, true)).wait();
};

deploy.tags = [CONTRACTS.PositionManager.name, "prod", "test"];
deploy.dependencies = [CONTRACTS.Market.name];
export default deploy;
