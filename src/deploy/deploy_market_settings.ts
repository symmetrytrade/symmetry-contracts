import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import {
    CONTRACTS,
    deployInBeaconProxy,
    getProxyContract,
    perpConfigKey,
    mustGetKey,
} from "../utils/utils";
import { getConfig } from "../config";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    await deployInBeaconProxy(hre, CONTRACTS.MarketSettings);

    const settings_ = await getProxyContract(
        hre,
        CONTRACTS.MarketSettings,
        deployer
    );

    // initialize
    console.log(`initializing ${CONTRACTS.MarketSettings.name}..`);
    await (await settings_.initialize()).wait();

    // set general config
    const config = getConfig(hre.network.name);
    for (const [term, rawValue] of Object.entries(config.marketGeneralConfig)) {
        const key = hre.ethers.utils.formatBytes32String(term);
        const value = hre.ethers.BigNumber.from(rawValue);
        await (await settings_.setUintVals(key, value)).wait();
    }

    // set market specific config
    for (const [market, conf] of Object.entries(config.marketConfig)) {
        const token =
            hre.network.name !== "hardhat"
                ? mustGetKey(config.addresses, market)
                : (await hre.ethers.getContract(market)).address;
        for (const [k, v] of Object.entries(conf)) {
            const key = perpConfigKey(token, k);
            const value = hre.ethers.BigNumber.from(v);
            await (await settings_.setUintVals(key, value)).wait();
        }
    }
};

deploy.tags = [CONTRACTS.MarketSettings.name, "prod"];
export default deploy;
