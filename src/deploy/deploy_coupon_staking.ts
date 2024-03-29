import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployInBeaconProxy, getTypedContract } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    await deployInBeaconProxy(hre, CONTRACTS.CouponStaking, [0, 10000000]);

    const coupon = await getTypedContract(hre, CONTRACTS.TradingFeeCoupon);
    const couponStaking = await getTypedContract(hre, CONTRACTS.CouponStaking);
    await (await couponStaking.initialize(deployer, coupon)).wait();
};

deploy.tags = [CONTRACTS.CouponStaking.name, "prod"];
deploy.dependencies = [CONTRACTS.TradingFeeCoupon.name];
export default deploy;
