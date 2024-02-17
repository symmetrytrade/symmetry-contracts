import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, MINTER_ROLE, deployInBeaconProxy, getTypedContract } from "../utils/utils";
import { getConfig } from "../config";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const config = getConfig(hre.network.name);

    await deployInBeaconProxy(hre, CONTRACTS.VolumeTracker);

    const volumeTracker_ = await getTypedContract(hre, CONTRACTS.VolumeTracker);

    // initialize
    console.log(`initializing ${CONTRACTS.VolumeTracker.name}..`);
    const market_ = await getTypedContract(hre, CONTRACTS.Market);
    const coupon_ = await getTypedContract(hre, CONTRACTS.TradingFeeCoupon);
    if (!(await volumeTracker_.initialized())) {
        await (await volumeTracker_.initialize(await market_.getAddress(), await coupon_.getAddress())).wait();
    }

    // set volumeTracker for market
    await (await market_.setVolumeTracker(await volumeTracker_.getAddress())).wait();

    // set lucky number announcer
    const announcer = config.otherConfig.luckyNumberAnnouncer ? config.otherConfig.luckyNumberAnnouncer : deployer;
    await (await volumeTracker_.setLuckyNumberAnnouncer(announcer)).wait();

    // set tiers
    await (await volumeTracker_.setRebateTiers(config.otherConfig.tradingFeeRebateTiers)).wait();

    // add minter role of coupon
    await (await coupon_.grantRole(MINTER_ROLE, await volumeTracker_.getAddress())).wait();
};

deploy.tags = [CONTRACTS.VolumeTracker.name, "prod"];
deploy.dependencies = [CONTRACTS.Market.name, CONTRACTS.MarketSettings.name, CONTRACTS.TradingFeeCoupon.name];
export default deploy;
