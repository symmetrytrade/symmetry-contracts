import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployInBeaconProxy, getTypedContract, MINTER_ROLE } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    await deployInBeaconProxy(hre, CONTRACTS.LiquidityManager);

    const liquidityManager_ = await getTypedContract(hre, CONTRACTS.LiquidityManager);

    // initialize
    console.log(`initializing ${CONTRACTS.LiquidityManager.name}..`);
    const market_ = await getTypedContract(hre, CONTRACTS.Market);
    const lpToken_ = await getTypedContract(hre, CONTRACTS.LPToken);
    if (!(await liquidityManager_.initialized())) {
        await (await liquidityManager_.initialize(market_, lpToken_)).wait();
    }

    // add operator
    console.log(`adding operator role for LiquidityManager to market..`);
    await (await market_.setOperator(liquidityManager_, true)).wait();

    // set minter role
    console.log(`set minter role of lp token for LiquidityManager..`);
    await (await lpToken_.grantRole(MINTER_ROLE, liquidityManager_)).wait();
};

deploy.tags = [CONTRACTS.LiquidityManager.name, "prod"];
deploy.dependencies = [CONTRACTS.Market.name, CONTRACTS.LPToken.name];
export default deploy;
