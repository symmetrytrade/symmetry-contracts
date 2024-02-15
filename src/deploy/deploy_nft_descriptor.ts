import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployInBeaconProxy, getTypedContract } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    await deployInBeaconProxy(hre, CONTRACTS.NFTDescriptor);

    const descriptor = await getTypedContract(hre, CONTRACTS.NFTDescriptor, deployer);
    await (await descriptor.initialize(deployer)).wait();
};

deploy.tags = [CONTRACTS.NFTDescriptor.name, "prod"];
export default deploy;
