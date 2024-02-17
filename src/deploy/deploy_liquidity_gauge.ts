import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { getConfig } from "../config";
import { CONTRACTS, deployInBeaconProxy, getTypedContract, MINTER_ROLE, VESTING_ROLE } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const config = getConfig(hre.network.name);

    await deployInBeaconProxy(hre, CONTRACTS.LiquidityGauge);

    const liquidityGauge_ = await getTypedContract(hre, CONTRACTS.LiquidityGauge);

    // initialize
    console.log(`initializing ${CONTRACTS.LiquidityGauge.name}..`);
    const votingEscrow_ = await getTypedContract(hre, CONTRACTS.VotingEscrow);
    const lpToken_ = await getTypedContract(hre, CONTRACTS.LPToken);
    const symRate_ = await getTypedContract(hre, CONTRACTS.SYMRate);
    const SYM_ = await getTypedContract(hre, CONTRACTS.SYM);
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
