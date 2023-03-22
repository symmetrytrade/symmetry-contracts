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

    const positionManager_ = await getProxyContract(
        hre,
        CONTRACTS.PositionManager,
        deployer
    );

    // initialize
    console.log(`initializing ${CONTRACTS.PositionManager.name}..`);
    const market_ = await getProxyContract(hre, CONTRACTS.Market, deployer);
    await (await positionManager_.initialize(market_.address)).wait();

    // add operator
    console.log(`adding operator role for PositionManager to market..`);
    await (await market_.setOperator(positionManager_.address, true)).wait();
};

deploy.tags = [CONTRACTS.PositionManager.name, "prod"];
deploy.dependencies = [CONTRACTS.Market.name];
export default deploy;
