import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
    CONTRACTS,
    deployInERC1967Proxy,
    getProxyContract,
} from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    await deployInERC1967Proxy(hre, CONTRACTS.PriceOracle);

    const oracle = await getProxyContract(hre, CONTRACTS.PriceOracle);
    oracle.connect(deployer);

    // initialize
    console.log(`initializing ${CONTRACTS.PriceOracle.name}..`);
    await (await oracle.initialize()).wait();
};

deploy.tags = [CONTRACTS.PriceOracle.name, "prod", "test"];
export default deploy;
