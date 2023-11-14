import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, SPENDER_ROLE, deployInBeaconProxy, getProxyContract } from "../utils/utils";
import { getConfig } from "../config";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const config = getConfig(hre.network.name);

    await deployInBeaconProxy(hre, CONTRACTS.Market);

    const market_ = await getProxyContract(hre, CONTRACTS.Market, deployer);

    // initialize
    console.log(`initializing ${CONTRACTS.Market.name}..`);
    const baseToken = config.addresses?.USDC
        ? config.addresses.USDC
        : (await hre.ethers.getContract(CONTRACTS.USDC.name)).address;
    const WETH = config.addresses?.WETH
        ? config.addresses.WETH
        : (await hre.ethers.getContract(CONTRACTS.WETH.name)).address;
    const priceOracle = (await hre.ethers.getContract(CONTRACTS.PriceOracle.name)).address;
    const marketSettings = (await hre.ethers.getContract(CONTRACTS.MarketSettings.name)).address;
    if (!(await market_.initialized())) {
        await (await market_.initialize(baseToken, priceOracle, marketSettings, WETH)).wait();
    }
    // set coupon
    const coupon_ = await getProxyContract(hre, CONTRACTS.TradingFeeCoupon, deployer);
    await (await market_.setCoupon(coupon_.address)).wait();

    // add spender role of coupon
    await (await coupon_.grantRole(SPENDER_ROLE, market_.address)).wait();

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
