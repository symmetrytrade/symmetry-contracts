import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, SPENDER_ROLE, deployInBeaconProxy, getTypedContract } from "../utils/utils";
import { getConfig } from "../config";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const config = getConfig(hre.network.name);

    await deployInBeaconProxy(hre, CONTRACTS.Market);

    const market_ = await getTypedContract(hre, CONTRACTS.Market);

    // initialize
    console.log(`initializing ${CONTRACTS.Market.name}..`);
    const baseToken = config.addresses?.USDC
        ? config.addresses.USDC
        : await (await hre.ethers.getContract(CONTRACTS.USDC.name)).getAddress();
    const WETH = config.addresses?.WETH
        ? config.addresses.WETH
        : await (await hre.ethers.getContract(CONTRACTS.WETH.name)).getAddress();
    const priceOracle = await (await hre.ethers.getContract(CONTRACTS.PriceOracle.name)).getAddress();
    const marketSettings = await (await hre.ethers.getContract(CONTRACTS.MarketSettings.name)).getAddress();
    if (!(await market_.initialized())) {
        await (await market_.initialize(baseToken, priceOracle, marketSettings, WETH)).wait();
    }
    // set coupon
    const coupon_ = await getTypedContract(hre, CONTRACTS.TradingFeeCoupon);
    await (await market_.setCoupon(await coupon_.getAddress())).wait();

    // add spender role of coupon
    await (await coupon_.grantRole(SPENDER_ROLE, await market_.getAddress())).wait();

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
