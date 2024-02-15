import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployInBeaconProxy, getTypedContract } from "../utils/utils";
import { getConfig } from "../config";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const config = getConfig(hre.network.name);

    await deployInBeaconProxy(hre, CONTRACTS.VotingEscrow);

    const votingEscrow_ = await getTypedContract(hre, CONTRACTS.VotingEscrow);

    // initialize
    console.log(`initializing ${CONTRACTS.VotingEscrow.name}..`);
    const baseToken = await (await getTypedContract(hre, CONTRACTS.SYM)).getAddress();
    if (!(await votingEscrow_.initialized())) {
        await (
            await votingEscrow_.initialize(
                baseToken,
                config.otherConfig.lockMaxTime,
                config.otherConfig.vestingWeeks,
                "Vote-Escrowed Symmetry",
                "veSYM"
            )
        ).wait();
    }
};

deploy.tags = [CONTRACTS.VotingEscrow.name, "prod"];
deploy.dependencies = [CONTRACTS.SYM.name, "mock"];
export default deploy;
