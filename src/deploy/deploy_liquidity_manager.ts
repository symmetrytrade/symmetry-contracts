import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
    CONTRACTS,
    MINTER_ROLE,
    deployInBeaconProxy,
    getProxyContract,
} from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    await deployInBeaconProxy(hre, CONTRACTS.LiquidityManager);

    const liquidityManager_ = await getProxyContract(
        hre,
        CONTRACTS.LiquidityManager,
        deployer
    );

    // initialize
    console.log(`initializing ${CONTRACTS.LiquidityManager.name}..`);
    const market_ = await getProxyContract(hre, CONTRACTS.Market, deployer);
    const lpToken_ = await hre.ethers.getContract(
        CONTRACTS.LPToken.name,
        deployer
    );
    if (!(await liquidityManager_.initialized())) {
        await (
            await liquidityManager_.initialize(
                market_.address,
                lpToken_.address
            )
        ).wait();
    }

    // add operator
    console.log(`adding operator role for LiquidityManager to market..`);
    await (await market_.setOperator(liquidityManager_.address, true)).wait();

    // set minter role
    console.log(`set minter role of lp token for LiquidityManager..`);
    await (
        await lpToken_.grantRole(MINTER_ROLE, liquidityManager_.address)
    ).wait();
};

deploy.tags = [CONTRACTS.LiquidityManager.name, "prod"];
deploy.dependencies = [CONTRACTS.Market.name, CONTRACTS.LPToken.name];
export default deploy;
