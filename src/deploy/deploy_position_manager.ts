import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, MINTER_ROLE, deployInBeaconProxy, getProxyContract } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    await deployInBeaconProxy(hre, CONTRACTS.PositionManager);

    const positionManager_ = await getProxyContract(hre, CONTRACTS.PositionManager, deployer);

    // initialize
    console.log(`initializing ${CONTRACTS.PositionManager.name}..`);
    const market_ = await getProxyContract(hre, CONTRACTS.Market, deployer);
    const coupon_ = await getProxyContract(hre, CONTRACTS.TradingFeeCoupon, deployer);
    if (!(await positionManager_.initialized())) {
        await (await positionManager_.initialize(await market_.getAddress(), await coupon_.getAddress())).wait();
    }

    // add operator
    console.log(`adding operator role for PositionManager to market..`);
    await (await market_.setOperator(await positionManager_.getAddress(), true)).wait();

    // add minter role
    await (await coupon_.grantRole(MINTER_ROLE, await positionManager_.getAddress())).wait();
};

deploy.tags = [CONTRACTS.PositionManager.name, "prod"];
deploy.dependencies = [CONTRACTS.Market.name, CONTRACTS.TradingFeeCoupon.name];
export default deploy;
