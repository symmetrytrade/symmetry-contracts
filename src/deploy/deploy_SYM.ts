import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const { deploy } = deployments;

    await deploy(CONTRACTS.SYM.name, {
        from: deployer,
        contract: CONTRACTS.SYM.contract,
        args: [],
        log: true,
    });

    // TODO: add minter
};

deploy.tags = [CONTRACTS.SYM.name, "prod"];
export default deploy;
