import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployInBeaconProxy, getProxyContract } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    await deployInBeaconProxy(hre, CONTRACTS.CouponStaking);

    const coupon = await hre.ethers.getContract(CONTRACTS.TradingFeeCoupon.name);
    const couponStaking = await getProxyContract(hre, CONTRACTS.CouponStaking, deployer);
    await (await couponStaking.initialize(deployer, coupon.address)).wait();
};

deploy.tags = [CONTRACTS.CouponStaking.name, "prod"];
deploy.dependencies = [CONTRACTS.TradingFeeCoupon.name];
export default deploy;
