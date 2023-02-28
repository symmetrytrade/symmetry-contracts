import { HardhatRuntimeEnvironment } from "hardhat/types";

const ERC1967PROXY = "ERC1967Proxy";

async function deployInERC1967Proxy(
    hre: HardhatRuntimeEnvironment,
    name: string,
    contractName: string
) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const { deploy } = deployments;
    // deploy implementation
    await deploy(`${name}Impl`, {
        from: deployer,
        contract: contractName,
        args: [],
        log: true,
    });
    const implementation = await hre.ethers.getContract(`${name}Impl`);
    // deploy proxy
    await deploy(name, {
        from: deployer,
        contract: ERC1967PROXY,
        args: [implementation.address, []],
        log: true,
    });
}

async function getProxyContract(hre: HardhatRuntimeEnvironment, name: string) {
    const address = (await hre.ethers.getContract(name)).address;
    return hre.ethers.getContractAt(name, address);
}

export { deployInERC1967Proxy, getProxyContract };
