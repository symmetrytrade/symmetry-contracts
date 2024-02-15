import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, MINTER_ROLE, VESTING_ROLE, deployInBeaconProxy, getTypedContract } from "../utils/utils";
import { getConfig } from "../config";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const config = getConfig(hre.network.name);

    await deployInBeaconProxy(hre, CONTRACTS.LiquidityGauge);

    const liquidityGauge_ = await getTypedContract(hre, CONTRACTS.LiquidityGauge, deployer);

    // initialize
    console.log(`initializing ${CONTRACTS.LiquidityGauge.name}..`);
    const votingEscrow_ = await getTypedContract(hre, CONTRACTS.VotingEscrow, deployer);
    const lpToken_ = await hre.ethers.getContract(CONTRACTS.LPToken.name, deployer);
    const symRate_ = await hre.ethers.getContract(CONTRACTS.SYMRate.name, deployer);
    const SYM_ = await hre.ethers.getContract(CONTRACTS.SYM.name, deployer);
    const startTime = config.otherConfig.liquidityGaugeStartTime || Math.floor(Date.now() / 1000);
    if (!(await liquidityGauge_.initialized())) {
        await (
            await liquidityGauge_.initialize(
                await votingEscrow_.getAddress(),
                await lpToken_.getAddress(),
                await symRate_.getAddress(),
                await SYM_.getAddress(),
                startTime
            )
        ).wait();
    }

    // add minter role of SYM
    await (await SYM_.grantRole(MINTER_ROLE, await liquidityGauge_.getAddress())).wait();
    // add vesting role of veSYM
    await (await votingEscrow_.grantRole(VESTING_ROLE, await liquidityGauge_.getAddress())).wait();
    // set liquidity gauge for lp token
    await (await lpToken_.setLiquidityGauge(await liquidityGauge_.getAddress())).wait();
};

deploy.tags = [CONTRACTS.LiquidityGauge.name, "prod"];
deploy.dependencies = [
    CONTRACTS.VotingEscrow.name,
    CONTRACTS.SYMRate.name,
    CONTRACTS.SYM.name,
    CONTRACTS.LPToken.name,
    "mock",
];
export default deploy;
