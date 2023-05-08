import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const { deploy } = deployments;

    await deploy(CONTRACTS.LPToken.name, {
        from: deployer,
        contract: CONTRACTS.LPToken.contract,
        args: ["SYM LP Token", "SYMLP"],
        log: true,
    });
};

deploy.tags = [CONTRACTS.LPToken.name, "prod"];
export default deploy;
