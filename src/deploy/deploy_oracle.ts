import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { config } from "../config";
import { deployInERC1967Proxy, getProxyContract } from "../utils/utils";

const NAME = "PriceOracle";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    if (hre.network.name in config) {
        return;
    }

    await deployInERC1967Proxy(hre, NAME, NAME);

    const oracle = await getProxyContract(hre, NAME);
    oracle.connect(deployer);

    // initialize
    await (await oracle.initialize()).wait();
};

deploy.tags = ["prod", "test"];
export default deploy;
