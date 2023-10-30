import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { CONTRACTS } from "../utils/utils";

const deploy: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const { deploy } = deployments;

    await deploy(CONTRACTS.TradingFeeCoupon.name, {
        from: deployer,
        contract: CONTRACTS.TradingFeeCoupon.contract,
        args: ["Symmetry Trading Coupon NFT", "SYM-COUPON"],
        log: true,
    });

    const descriptor_ = await hre.ethers.getContract(CONTRACTS.NFTDescriptor.name);
    const coupon_ = await hre.ethers.getContract(CONTRACTS.TradingFeeCoupon.name);
    // set descriptor
    await (await coupon_.setDescriptor(descriptor_.address)).wait();
};

deploy.tags = [CONTRACTS.TradingFeeCoupon.name, "prod"];
deploy.dependencies = [CONTRACTS.NFTDescriptor.name];
export default deploy;
