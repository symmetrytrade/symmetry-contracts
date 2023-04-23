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
        args: ["Symmetry Coupon", "SYMCoupon", "Symmetry Coupon"],
        log: true,
    });

    // TODO: add minter & spender
};

deploy.tags = [CONTRACTS.TradingFeeCoupon.name, "prod"];
export default deploy;
