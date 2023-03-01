import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
    CONTRACTS,
    MINTER_ROLE,
    deployInERC1967Proxy,
    getProxyContract,
} from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    await deployInERC1967Proxy(hre, CONTRACTS.LiquidityManager);

    const liquidityManager = await getProxyContract(
        hre,
        CONTRACTS.LiquidityManager
    );
    liquidityManager.connect(deployer);

    // initialize
    console.log(`initializing ${CONTRACTS.LiquidityManager.name}..`);
    const market = await getProxyContract(hre, CONTRACTS.Market);
    const lpToken = await getProxyContract(hre, CONTRACTS.LPToken);
    await (
        await liquidityManager.initialize(market.address, lpToken.address)
    ).wait();

    // add operator
    console.log(`adding operator role for LiquidityManager to market..`);
    market.connect(deployer);
    await (await market.setOperator(liquidityManager.address, true)).wait();

    // set minter role
    console.log(`set minter role of lp token for LiquidityManager..`);
    lpToken.connect(deployer);
    await (
        await lpToken.grantRole(MINTER_ROLE, liquidityManager.address)
    ).wait();
};

deploy.tags = [CONTRACTS.LiquidityManager.name, "prod", "test"];
deploy.dependencies = [CONTRACTS.Market.name, CONTRACTS.LPToken.name];
export default deploy;
