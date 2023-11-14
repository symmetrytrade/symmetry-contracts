import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployInBeaconProxy, getProxyContract } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();

    await deployInBeaconProxy(hre, CONTRACTS.TradingFeeCoupon);

    console.log(`initializing ${CONTRACTS.TradingFeeCoupon.name}..`);
    const coupon_ = await getProxyContract(hre, CONTRACTS.TradingFeeCoupon, deployer);
    if (!(await coupon_.initialized())) {
        await (await coupon_.initialize("Symmetry Trading Coupon NFT", "SYM-COUPON")).wait();
    }

    const descriptor_ = await hre.ethers.getContract(CONTRACTS.NFTDescriptor.name);
    // set descriptor
    await (await coupon_.setDescriptor(descriptor_.address)).wait();
};

deploy.tags = [CONTRACTS.TradingFeeCoupon.name, "prod"];
deploy.dependencies = [CONTRACTS.NFTDescriptor.name];
export default deploy;
