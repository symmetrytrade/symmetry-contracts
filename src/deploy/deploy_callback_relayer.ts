import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployDirectly, getTypedContract } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    await deployDirectly(hre, CONTRACTS.VotingEscrowCallbackRelayer);

    const relayer_ = await hre.ethers.getContract(CONTRACTS.VotingEscrowCallbackRelayer.name, deployer);
    const liquidityGauge_ = await getTypedContract(hre, CONTRACTS.LiquidityGauge, deployer);
    await (await relayer_.addCallbackHandle(await liquidityGauge_.getAddress())).wait();

    const votingEscrow_ = await getTypedContract(hre, CONTRACTS.VotingEscrow, deployer);
    await (await votingEscrow_.setCallbackRelayer(await relayer_.getAddress())).wait();
};

deploy.tags = [CONTRACTS.VotingEscrowCallbackRelayer.name, "prod"];
deploy.dependencies = [CONTRACTS.VotingEscrow.name, CONTRACTS.LiquidityGauge.name, "mock"];
export default deploy;
