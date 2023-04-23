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

    await deployInBeaconProxy(hre, CONTRACTS.VotingEscrow);

    const votingEscrow_ = await getProxyContract(
        hre,
        CONTRACTS.VotingEscrow,
        deployer
    );

    // initialize
    console.log(`initializing ${CONTRACTS.VotingEscrow.name}..`);
    const baseToken = (await hre.ethers.getContract(CONTRACTS.SYM.name))
        .address;
    await (
        await votingEscrow_.initialize(
            baseToken,
            config.otherConfig.lockMaxTime,
            "Vote-Escrowed Symmetry",
            "veSYM"
        )
    ).wait();
};

deploy.tags = [CONTRACTS.VotingEscrow.name, "prod"];
deploy.dependencies = [CONTRACTS.SYM.name, "mock"];
export default deploy;
