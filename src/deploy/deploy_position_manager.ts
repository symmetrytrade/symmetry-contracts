import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployInBeaconProxy, getTypedContract, MINTER_ROLE } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    await deployInBeaconProxy(hre, CONTRACTS.PositionManager);

    const positionManager_ = await getTypedContract(hre, CONTRACTS.PositionManager);

    // initialize
    console.log(`initializing ${CONTRACTS.PositionManager.name}..`);
    const market_ = await getTypedContract(hre, CONTRACTS.Market);
    const coupon_ = await getTypedContract(hre, CONTRACTS.TradingFeeCoupon);
    if (!(await positionManager_.initialized())) {
        await (await positionManager_.initialize(market_, coupon_)).wait();
    }

    // add operator
    console.log(`adding operator role for PositionManager to market..`);
    await (await market_.setOperator(positionManager_, true)).wait();

    // add minter role
    await (await coupon_.grantRole(MINTER_ROLE, positionManager_)).wait();
};

deploy.tags = [CONTRACTS.PositionManager.name, "prod"];
deploy.dependencies = [CONTRACTS.Market.name, CONTRACTS.TradingFeeCoupon.name];
export default deploy;
