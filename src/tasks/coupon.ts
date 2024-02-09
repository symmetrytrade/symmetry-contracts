import "hardhat-deploy";
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
            await (await coupon.setDescriptor(await descriptor.getAddress())).wait();
        } else {
            console.log(`to: ${await coupon.getAddress()}`);
            console.log(coupon.interface.getFunction("setDescriptor").format());
            console.log(
                `data: ${coupon.interface.encodeFunctionData("setDescriptor", [await descriptor.getAddress()])}`
            );
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
        await (await couponStaking.initialize(taskArgs.timelock, await coupon.getAddress())).wait();

        const feeTracker_ = await getProxyContract(hre, CONTRACTS.FeeTracker, deployer);
        if (await feeTracker_.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
            await (await feeTracker_.setCouponStaking(await couponStaking.getAddress())).wait();
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
            await (await coupon.grantRole(MINTER_ROLE, await tokenMinter.getAddress())).wait();
        } else {
            console.log(`to: ${await coupon.getAddress()}`);
            console.log(coupon.interface.getFunction("grantRole").format());
            console.log(MINTER_ROLE);
            console.log(await tokenMinter.getAddress());
            console.log(
                `data: ${coupon.interface.encodeFunctionData("grantRole", [
                    MINTER_ROLE,
                    await tokenMinter.getAddress(),
                ])}`
            );
        }
    });
