import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { getConfig } from "../config";
import { CONTRACTS, deployInBeaconProxy, getTypedContract, mustGetKey } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const config = getConfig(hre.network.name);

    await deployInBeaconProxy(hre, CONTRACTS.MarginTracker);

    const marginTracker_ = await getTypedContract(hre, CONTRACTS.MarginTracker);

    // initialize
    console.log(`initializing ${CONTRACTS.MarginTracker.name}..`);
    const market_ = await getTypedContract(hre, CONTRACTS.Market);
    const interestRateModel_ = await getTypedContract(hre, CONTRACTS.DebtInterestRateModel);
    if (!(await marginTracker_.initialized())) {
        await (await marginTracker_.initialize(market_, interestRateModel_)).wait();
    }

    // set marginTracker for market
    await (await market_.setMarginTracker(marginTracker_)).wait();

    // initialize interest rate model
    console.log(`initializing ${CONTRACTS.DebtInterestRateModel.name}..`);
    if (!(await interestRateModel_.initialized())) {
        await (await interestRateModel_.initialize(market_, marginTracker_)).wait();
    }

    // set operator role
    console.log(`adding operator role for LiquidityManager to market..`);
    await (await market_.setOperator(marginTracker_, true)).wait();

    // add tokens
    for (const collateral of Object.keys(config.marginConfig)) {
        const token_ =
            hre.network.name !== "hardhat"
                ? mustGetKey(config.addresses, collateral)
                : await hre.ethers.getContract(collateral);
        await (await marginTracker_.addCollateralToken(token_)).wait();
    }
};

deploy.tags = [CONTRACTS.MarginTracker.name, "prod"];
deploy.dependencies = [CONTRACTS.Market.name, CONTRACTS.MarketSettings.name, CONTRACTS.DebtInterestRateModel.name];
export default deploy;
