import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployDirectly } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    await deployDirectly(hre, CONTRACTS.SYM);

    // TODO: add minter
};

deploy.tags = [CONTRACTS.SYM.name, "prod"];
export default deploy;
