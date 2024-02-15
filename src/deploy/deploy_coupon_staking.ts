import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployInBeaconProxy, getTypedContract } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    await deployInBeaconProxy(hre, CONTRACTS.CouponStaking, [0, 10000000]);

    const coupon = await hre.ethers.getContract(CONTRACTS.TradingFeeCoupon.name);
    const couponStaking = await getTypedContract(hre, CONTRACTS.CouponStaking, deployer);
    await (await couponStaking.initialize(deployer, await coupon.getAddress())).wait();
};

deploy.tags = [CONTRACTS.CouponStaking.name, "prod"];
deploy.dependencies = [CONTRACTS.TradingFeeCoupon.name];
export default deploy;
