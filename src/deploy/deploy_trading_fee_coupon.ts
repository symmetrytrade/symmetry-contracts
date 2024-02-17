import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS, deployInBeaconProxy, getTypedContract } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    await deployInBeaconProxy(hre, CONTRACTS.TradingFeeCoupon);

    console.log(`initializing ${CONTRACTS.TradingFeeCoupon.name}..`);
    const coupon_ = await getTypedContract(hre, CONTRACTS.TradingFeeCoupon);
    if (!(await coupon_.initialized())) {
        await (await coupon_.initialize("Symmetry Trading Coupon NFT", "SYM-COUPON")).wait();
    }

    const descriptor_ = await getTypedContract(hre, CONTRACTS.NFTDescriptor);
    // set descriptor
    await (await coupon_.setDescriptor(await descriptor_.getAddress())).wait();
};

deploy.tags = [CONTRACTS.TradingFeeCoupon.name, "prod"];
deploy.dependencies = [CONTRACTS.NFTDescriptor.name];
export default deploy;
