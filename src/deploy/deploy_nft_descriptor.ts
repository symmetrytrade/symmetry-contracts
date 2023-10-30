import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const { deploy } = deployments;

    await deploy(CONTRACTS.NFTDescriptor.name, {
        from: deployer,
        contract: CONTRACTS.NFTDescriptor.contract,
        args: [],
        log: true,
    });
};

deploy.tags = [CONTRACTS.NFTDescriptor.name, "prod"];
export default deploy;
