import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { getConfig } from "../config";
import { CONTRACTS, deployInBeaconProxy, getTypedContract } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const config = getConfig(hre.network.name);

    await deployInBeaconProxy(hre, CONTRACTS.FeeTracker);

    const feeTracker_ = await getTypedContract(hre, CONTRACTS.FeeTracker);

    // initialize
    console.log(`initializing ${CONTRACTS.FeeTracker.name}..`);
    const market_ = await getTypedContract(hre, CONTRACTS.Market);
    const votingEscrow_ = await getTypedContract(hre, CONTRACTS.VotingEscrow);
    const perpTracker_ = await getTypedContract(hre, CONTRACTS.PerpTracker);
    const coupon_ = await getTypedContract(hre, CONTRACTS.TradingFeeCoupon);
    if (!(await feeTracker_.initialized())) {
        await (
            await feeTracker_.initialize(
                await market_.getAddress(),
                await perpTracker_.getAddress(),
                await coupon_.getAddress(),
                await votingEscrow_.getAddress()
            )
        ).wait();
    }

    // set feeTracker for market
    await (await market_.setFeeTracker(await feeTracker_.getAddress())).wait();

    // set fee tiers
    await (await feeTracker_.setTradingFeeTiers(config.otherConfig.tradingFeeTiers)).wait();

    // set coupon staking
    const couponStaking_ = await getTypedContract(hre, CONTRACTS.CouponStaking);
    await (await feeTracker_.setCouponStaking(await couponStaking_.getAddress())).wait();
};

deploy.tags = [CONTRACTS.FeeTracker.name, "prod"];
deploy.dependencies = [
    CONTRACTS.Market.name,
    CONTRACTS.MarketSettings.name,
    CONTRACTS.PerpTracker.name,
    CONTRACTS.VotingEscrow.name,
    CONTRACTS.TradingFeeCoupon.name,
    CONTRACTS.CouponStaking.name,
];
export default deploy;
