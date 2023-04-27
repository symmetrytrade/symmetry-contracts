import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
    CONTRACTS,
    deployInBeaconProxy,
    getProxyContract,
} from "../utils/utils";
import { getConfig } from "../config";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const config = getConfig(hre.network.name);

    await deployInBeaconProxy(hre, CONTRACTS.LiquidityGauge);

    const liquidityGauge_ = await getProxyContract(
        hre,
        CONTRACTS.LiquidityGauge,
        deployer
    );

    // initialize
    console.log(`initializing ${CONTRACTS.LiquidityGauge.name}..`);
    const votingEscrow_ = await getProxyContract(
        hre,
        CONTRACTS.VotingEscrow,
        deployer
    );
    const symRate_ = await hre.ethers.getContract(
        CONTRACTS.SYMRate.name,
        deployer
    );
    const SYM_ = await hre.ethers.getContract(CONTRACTS.SYM.name, deployer);
    const startTime =
        config.otherConfig.liquidityGaugeStartTime ||
        Math.floor(Date.now() / 1000);
    await (
        await liquidityGauge_.initialize(
            votingEscrow_.address,
            symRate_.address,
            SYM_.address,
            startTime
        )
    ).wait();
};

deploy.tags = [CONTRACTS.LiquidityGauge.name, "prod"];
deploy.dependencies = [
    CONTRACTS.VotingEscrow.name,
    CONTRACTS.SYMRate.name,
    CONTRACTS.SYM.name,
    "mock",
];
export default deploy;
