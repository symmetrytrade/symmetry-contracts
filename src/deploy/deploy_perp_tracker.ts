import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { getConfig } from "../config";
import { CONTRACTS, deployInBeaconProxy, getTypedContract, mustGetKey } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const config = getConfig(hre.network.name);

    await deployInBeaconProxy(hre, CONTRACTS.PerpTracker);

    const perpTracker_ = await getTypedContract(hre, CONTRACTS.PerpTracker);

    // initialize
    console.log(`initializing ${CONTRACTS.PerpTracker.name}..`);
    const market_ = await getTypedContract(hre, CONTRACTS.Market);

    if (!(await perpTracker_.initialized())) {
        await (await perpTracker_.initialize(market_)).wait();
    }

    // set market tokens
    for (const market of Object.keys(config.marketConfig)) {
        const token_ =
            hre.network.name !== "hardhat"
                ? mustGetKey(config.addresses, market)
                : await hre.ethers.getContract(market);
        await (await perpTracker_.addMarketToken(token_)).wait();
    }

    // set perpTracker for market
    await (await market_.setPerpTracker(perpTracker_)).wait();
};

deploy.tags = [CONTRACTS.PerpTracker.name, "prod"];
deploy.dependencies = [CONTRACTS.Market.name, CONTRACTS.MarketSettings.name];
export default deploy;
