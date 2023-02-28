import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { config } from "../config";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const { deploy } = deployments;
    if (hre.network.name in config) {
        return;
    }

    await deploy("USDC", {
        from: deployer,
        contract: "ERC20",
        args: ["USD Coin", "USDC"],
        log: true,
    });
};

deploy.tags = ["test"];
export default deploy;
