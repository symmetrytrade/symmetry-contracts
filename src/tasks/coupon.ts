import "hardhat-deploy";
import "@nomiclabs/hardhat-ethers";
import { task, types } from "hardhat/config";
import { CONTRACTS, DEFAULT_ADMIN_ROLE, MINTER_ROLE, deployInBeaconProxy, getProxyContract } from "../utils/utils";

task("descriptor:deploy", "deploy NFT descriptor")
    .addParam("timelock", "timelock address", undefined, types.string, false)
    .setAction(async (taskArgs, hre) => {
        const { getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();

        await deployInBeaconProxy(hre, CONTRACTS.NFTDescriptor);

        const descriptor = await getProxyContract(hre, CONTRACTS.NFTDescriptor, deployer);
        await (await descriptor.initialize(taskArgs.timelock)).wait();

        const coupon = await getProxyContract(hre, CONTRACTS.TradingFeeCoupon, deployer);
        if (await coupon.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
            await (await coupon.setDescriptor(descriptor.address)).wait();
        } else {
            console.log(`to: ${coupon.address}`);
            console.log(coupon.interface.getFunction("setDescriptor").format());
            console.log(`data: ${coupon.interface.encodeFunctionData("setDescriptor", [descriptor.address])}`);
        }
    });

task("couponStaking:deploy", "deploy coupon staking")
    .addParam("timelock", "timelock address", undefined, types.string, false)
    .addParam("start", "start time", undefined, types.int, false)
    .addParam("end", "end time", undefined, types.int, false)
    .setAction(async (taskArgs, hre) => {
        const { getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();

        await deployInBeaconProxy(hre, CONTRACTS.CouponStaking, [taskArgs.start, taskArgs.end]);

        const coupon = await hre.ethers.getContract(CONTRACTS.TradingFeeCoupon.name);
        const couponStaking = await getProxyContract(hre, CONTRACTS.CouponStaking, deployer);
        await (await couponStaking.initialize(taskArgs.timelock, coupon.address)).wait();

        const feeTracker_ = await getProxyContract(hre, CONTRACTS.FeeTracker, deployer);
        if (await feeTracker_.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
            await (await feeTracker_.setCouponStaking(couponStaking.address)).wait();
        }
    });

task("minter:deploy", "deploy token minter")
    .addParam("timelock", "timelock address", undefined, types.string, false)
    .setAction(async (taskArgs, hre) => {
        const { getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();

        await deployInBeaconProxy(hre, CONTRACTS.TokenMinter);

        const tokenMinter = await getProxyContract(hre, CONTRACTS.TokenMinter, deployer);
        await (await tokenMinter.initialize(taskArgs.timelock)).wait();

        const coupon = await getProxyContract(hre, CONTRACTS.TradingFeeCoupon, deployer);
        if (await coupon.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
            await (await coupon.grantRole(MINTER_ROLE, tokenMinter.address)).wait();
        } else {
            console.log(`to: ${coupon.address}`);
            console.log(coupon.interface.getFunction("grantRole").format());
            console.log(MINTER_ROLE);
            console.log(tokenMinter.address);
            console.log(
                `data: ${coupon.interface.encodeFunctionData("grantRole", [MINTER_ROLE, tokenMinter.address])}`
            );
        }
    });
