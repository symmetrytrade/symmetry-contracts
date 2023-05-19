import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployInBeaconProxy, getProxyContract } from "../utils/utils";
import { getConfig } from "../config";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const config = getConfig(hre.network.name);

    await deployInBeaconProxy(hre, CONTRACTS.FeeTracker);

    const feeTracker_ = await getProxyContract(hre, CONTRACTS.FeeTracker, deployer);

    // initialize
    console.log(`initializing ${CONTRACTS.FeeTracker.name}..`);
    const market_ = await getProxyContract(hre, CONTRACTS.Market, deployer);
    const votingEscrow_ = await getProxyContract(hre, CONTRACTS.VotingEscrow, deployer);
    const perpTracker_ = await getProxyContract(hre, CONTRACTS.PerpTracker, deployer);
    const coupon_ = await hre.ethers.getContract(CONTRACTS.TradingFeeCoupon.name, deployer);
    if (!(await feeTracker_.initialized())) {
        await (
            await feeTracker_.initialize(market_.address, perpTracker_.address, coupon_.address, votingEscrow_.address)
        ).wait();
    }

    // set feeTracker for market
    await (await market_.setFeeTracker(feeTracker_.address)).wait();

    // set fee tiers
    const tiers = [];
    for (const tier of config.otherConfig.tradingFeeTiers) {
        tiers.push([tier.portion, tier.discount]);
    }
    await (await feeTracker_.setTradingFeeTiers(tiers)).wait();
};

deploy.tags = [CONTRACTS.FeeTracker.name, "prod"];
deploy.dependencies = [
    CONTRACTS.Market.name,
    CONTRACTS.MarketSettings.name,
    CONTRACTS.PerpTracker.name,
    CONTRACTS.VotingEscrow.name,
    CONTRACTS.TradingFeeCoupon.name,
];
export default deploy;
