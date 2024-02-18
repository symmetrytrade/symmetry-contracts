import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployInBeaconProxy, getTypedContract, mustGetKey } from "../utils/utils";
import { getConfig } from "../config";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const config = getConfig(hre.network.name);

    await deployInBeaconProxy(hre, CONTRACTS.MarginTracker);

    const marginTracker_ = await getTypedContract(hre, CONTRACTS.MarginTracker);

    // initialize
    console.log(`initializing ${CONTRACTS.MarginTracker.name}..`);
    const market_ = await getTypedContract(hre, CONTRACTS.Market);
    const interestRateModel_ = await getTypedContract(hre, CONTRACTS.DebtInterestRateModel);
    if (!(await marginTracker_.initialized())) {
        await (
            await marginTracker_.initialize(await market_.getAddress(), await interestRateModel_.getAddress())
        ).wait();
    }

    // set marginTracker for market
    await (await market_.setMarginTracker(await marginTracker_.getAddress())).wait();

    // initialize interest rate model
    console.log(`initializing ${CONTRACTS.DebtInterestRateModel.name}..`);
    if (!(await interestRateModel_.initialized())) {
        await (
            await interestRateModel_.initialize(await market_.getAddress(), await marginTracker_.getAddress())
        ).wait();
    }

    // set operator role
    console.log(`adding operator role for LiquidityManager to market..`);
    await (await market_.setOperator(await marginTracker_.getAddress(), true)).wait();

    // add tokens
    for (const collateral of Object.keys(config.marginConfig)) {
        const token =
            hre.network.name !== "hardhat"
                ? mustGetKey(config.addresses, collateral)
                : await (await hre.ethers.getContract(collateral)).getAddress();
        await (await marginTracker_.addCollateralToken(token)).wait();
    }
};

deploy.tags = [CONTRACTS.MarginTracker.name, "prod"];
deploy.dependencies = [CONTRACTS.Market.name, CONTRACTS.MarketSettings.name, CONTRACTS.DebtInterestRateModel.name];
export default deploy;
