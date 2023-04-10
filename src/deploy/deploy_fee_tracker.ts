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

    await deployInBeaconProxy(hre, CONTRACTS.FeeTracker);

    const feeTracker_ = await getProxyContract(
        hre,
        CONTRACTS.FeeTracker,
        deployer
    );

    // initialize
    console.log(`initializing ${CONTRACTS.FeeTracker.name}..`);
    const market_ = await getProxyContract(hre, CONTRACTS.Market, deployer);
    const perpTracker_ = await getProxyContract(
        hre,
        CONTRACTS.PerpTracker,
        deployer
    );
    await (
        await feeTracker_.initialize(market_.address, perpTracker_.address)
    ).wait();

    // set feeTracker for market
    await (await market_.setFeeTracker(feeTracker_.address)).wait();
};

deploy.tags = [CONTRACTS.FeeTracker.name, "prod"];
deploy.dependencies = [
    CONTRACTS.Market.name,
    CONTRACTS.MarketSettings.name,
    CONTRACTS.PerpTracker.name,
];
export default deploy;
