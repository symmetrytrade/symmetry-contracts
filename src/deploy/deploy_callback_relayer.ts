import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployDirectly, getTypedContract } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    await deployDirectly(hre, CONTRACTS.VotingEscrowCallbackRelayer);

    const relayer_ = await getTypedContract(hre, CONTRACTS.VotingEscrowCallbackRelayer);
    const liquidityGauge_ = await getTypedContract(hre, CONTRACTS.LiquidityGauge);
    await (await relayer_.addCallbackHandle(liquidityGauge_)).wait();

    const votingEscrow_ = await getTypedContract(hre, CONTRACTS.VotingEscrow);
    await (await votingEscrow_.setCallbackRelayer(relayer_)).wait();
};

deploy.tags = [CONTRACTS.VotingEscrowCallbackRelayer.name, "prod"];
deploy.dependencies = [CONTRACTS.VotingEscrow.name, CONTRACTS.LiquidityGauge.name, "mock"];
export default deploy;
