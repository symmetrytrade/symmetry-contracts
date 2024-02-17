import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployDirectly } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    await deployDirectly(hre, CONTRACTS.LPToken, ["SYM LP Token", "symLP"]);
};

deploy.tags = [CONTRACTS.LPToken.name, "prod"];
export default deploy;
