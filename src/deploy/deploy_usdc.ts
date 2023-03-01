import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { GlobalConfig } from "../config";
import { CONTRACTS } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const { deploy } = deployments;
    // skip if exists
    if (GlobalConfig[hre.network.name].addresses?.USDC) return;

    await deploy(CONTRACTS.USDC.name, {
        from: deployer,
        contract: CONTRACTS.USDC.contract,
        args: ["USD Coin", "USDC"],
        log: true,
    });
};

deploy.tags = [CONTRACTS.USDC.name, "test"];
export default deploy;
