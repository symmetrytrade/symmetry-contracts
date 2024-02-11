import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployDirectly } from "../utils/utils";
import { getConfig } from "../config";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const config = getConfig(hre.network.name);

    await deployDirectly(hre, CONTRACTS.SYMRate);

    const symRate_ = await hre.ethers.getContract(CONTRACTS.SYMRate.name, deployer);

    const rates = [];
    for (const rate of config.otherConfig.symRate) {
        const startTime = rate.startTime || Math.floor(Date.now() / 1000);
        rates.push([startTime, rate.rate]);
    }
    await (await symRate_.changeRate(rates)).wait();
};

deploy.tags = [CONTRACTS.SYMRate.name, "prod"];
export default deploy;
