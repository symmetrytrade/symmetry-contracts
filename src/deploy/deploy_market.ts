import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { getConfig } from "../config";
import { CONTRACTS, deployInBeaconProxy, getTypedContract, SPENDER_ROLE } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const config = getConfig(hre.network.name);

    await deployInBeaconProxy(hre, CONTRACTS.Market);

    const market_ = await getTypedContract(hre, CONTRACTS.Market);

    // initialize
    console.log(`initializing ${CONTRACTS.Market.name}..`);
    const baseToken_ = config.addresses?.USDC ?? (await getTypedContract(hre, CONTRACTS.USDC));
    const WETH_ = config.addresses?.WETH ?? (await getTypedContract(hre, CONTRACTS.WETH));
    const priceOracle_ = await getTypedContract(hre, CONTRACTS.PriceOracle);
    const marketSettings_ = await getTypedContract(hre, CONTRACTS.MarketSettings);
    if (!(await market_.initialized())) {
        await (await market_.initialize(baseToken_, priceOracle_, marketSettings_, WETH_)).wait();
    }
    // set coupon
    const coupon_ = await getTypedContract(hre, CONTRACTS.TradingFeeCoupon);
    await (await market_.setCoupon(coupon_)).wait();

    // add spender role of coupon
    await (await coupon_.grantRole(SPENDER_ROLE, market_)).wait();

    // set treasury
    await (await market_.setTreasury(config.otherConfig.treasuryAddr)).wait();
};

deploy.tags = [CONTRACTS.Market.name, "prod"];
deploy.dependencies = [
    CONTRACTS.PriceOracle.name,
    CONTRACTS.MarketSettings.name,
    CONTRACTS.TradingFeeCoupon.name,
    "mock",
];
export default deploy;
