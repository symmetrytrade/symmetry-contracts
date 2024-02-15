import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployDirectly, getTypedContract } from "../utils/utils";
import { getConfig } from "../config";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const config = getConfig(hre.network.name);

    await deployDirectly(hre, CONTRACTS.SYMRate);

    const symRate_ = await getTypedContract(hre, CONTRACTS.SYMRate);

    const rates = [];
    for (const rate of config.otherConfig.symRate) {
        const startTime = rate.startTime || Math.floor(Date.now() / 1000);
        rates.push([startTime, rate.rate]);
    }
    await (await symRate_.changeRate(rates)).wait();
};

deploy.tags = [CONTRACTS.SYMRate.name, "prod"];
export default deploy;
