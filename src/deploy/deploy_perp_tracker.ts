import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployInBeaconProxy, getTypedContract, mustGetKey } from "../utils/utils";
import { getConfig } from "../config";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const config = getConfig(hre.network.name);

    await deployInBeaconProxy(hre, CONTRACTS.PerpTracker);

    const perpTracker_ = await getTypedContract(hre, CONTRACTS.PerpTracker, deployer);

    // initialize
    console.log(`initializing ${CONTRACTS.PerpTracker.name}..`);
    const market_ = await getTypedContract(hre, CONTRACTS.Market, deployer);

    if (!(await perpTracker_.initialized())) {
        await (await perpTracker_.initialize(await market_.getAddress())).wait();
    }

    // set market tokens
    for (const [market] of Object.entries(config.marketConfig)) {
        const token =
            hre.network.name !== "hardhat"
                ? mustGetKey(config.addresses, market)
                : await (await hre.ethers.getContract(market)).getAddress();
        await (await perpTracker_.addMarketToken(token)).wait();
    }

    // set perpTracker for market
    await (await market_.setPerpTracker(await perpTracker_.getAddress())).wait();
};

deploy.tags = [CONTRACTS.PerpTracker.name, "prod"];
deploy.dependencies = [CONTRACTS.Market.name, CONTRACTS.MarketSettings.name];
export default deploy;
