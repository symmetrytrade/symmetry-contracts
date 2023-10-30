import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployInBeaconProxy, getProxyContract, mustGetKey } from "../utils/utils";
import { getConfig } from "../config";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const config = getConfig(hre.network.name);

    await deployInBeaconProxy(hre, CONTRACTS.MarginTracker);

    const marginTracker_ = await getProxyContract(hre, CONTRACTS.MarginTracker, deployer);

    // initialize
    console.log(`initializing ${CONTRACTS.MarginTracker.name}..`);
    const market_ = await getProxyContract(hre, CONTRACTS.Market, deployer);
    const interestRateModel_ = await getProxyContract(hre, CONTRACTS.DebtInterestRateModel, deployer);
    if (!(await marginTracker_.initialized())) {
        await (await marginTracker_.initialize(market_.address, interestRateModel_.address)).wait();
    }

    // set marginTracker for market
    await (await market_.setMarginTracker(marginTracker_.address)).wait();

    // initialize interest rate model
    console.log(`initializing ${CONTRACTS.DebtInterestRateModel.name}..`);
    if (!(await interestRateModel_.initialized())) {
        await (await interestRateModel_.initialize(market_.address, marginTracker_.address)).wait();
    }

    // set operator role
    console.log(`adding operator role for LiquidityManager to market..`);
    await (await market_.setOperator(marginTracker_.address, true)).wait();

    // add tokens
    for (const [collateral] of Object.entries(config.marginConfig)) {
        const token =
            hre.network.name !== "hardhat"
                ? mustGetKey(config.addresses, collateral)
                : (await hre.ethers.getContract(collateral)).address;
        await (await marginTracker_.addCollateralToken(token)).wait();
    }
};

deploy.tags = [CONTRACTS.MarginTracker.name, "prod"];
deploy.dependencies = [CONTRACTS.Market.name, CONTRACTS.MarketSettings.name, CONTRACTS.DebtInterestRateModel.name];
export default deploy;
