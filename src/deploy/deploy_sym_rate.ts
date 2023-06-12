import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS } from "../utils/utils";
import { getConfig } from "../config";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const { deploy } = deployments;
    const config = getConfig(hre.network.name);

    await deploy(CONTRACTS.SYMRate.name, {
        from: deployer,
        contract: CONTRACTS.SYMRate.contract,
        args: [],
        log: true,
    });

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
