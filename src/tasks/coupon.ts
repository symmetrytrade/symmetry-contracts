import { task, types } from "hardhat/config";
import { CONTRACTS, DEFAULT_ADMIN_ROLE, deployInBeaconProxy, getTypedContract, MINTER_ROLE } from "../utils/utils";

task("descriptor:deploy", "deploy NFT descriptor")
    .addParam("timelock", "timelock address", undefined, types.string, false)
    .setAction(async (taskArgs: { timelock: string }, hre) => {
        const { getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();

        await deployInBeaconProxy(hre, CONTRACTS.NFTDescriptor);

        const descriptor = await getTypedContract(hre, CONTRACTS.NFTDescriptor);
        await (await descriptor.initialize(taskArgs.timelock)).wait();

        const coupon = await getTypedContract(hre, CONTRACTS.TradingFeeCoupon);
        if (await coupon.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
            await (await coupon.setDescriptor(descriptor)).wait();
        } else {
            console.log(`to: ${await coupon.getAddress()}`);
            console.log(coupon.interface.getFunction("setDescriptor").format());
            console.log(`data: ${coupon.interface.encodeFunctionData("setDescriptor", [descriptor])}`);
        }
    });

task("couponStaking:deploy", "deploy coupon staking")
    .addParam("timelock", "timelock address", undefined, types.string, false)
    .addParam("start", "start time", undefined, types.int, false)
    .addParam("end", "end time", undefined, types.int, false)
    .setAction(async (taskArgs: { timelock: string; start: number; end: number }, hre) => {
        const { getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();

        await deployInBeaconProxy(hre, CONTRACTS.CouponStaking, [taskArgs.start, taskArgs.end]);

        const coupon = await getTypedContract(hre, CONTRACTS.TradingFeeCoupon);
        const couponStaking = await getTypedContract(hre, CONTRACTS.CouponStaking);
        await (await couponStaking.initialize(taskArgs.timelock, coupon)).wait();

        const feeTracker_ = await getTypedContract(hre, CONTRACTS.FeeTracker);
        if (await feeTracker_.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
            await (await feeTracker_.setCouponStaking(couponStaking)).wait();
        }
    });

task("minter:deploy", "deploy token minter")
    .addParam("timelock", "timelock address", undefined, types.string, false)
    .setAction(async (taskArgs: { timelock: string }, hre) => {
        const { getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();

        await deployInBeaconProxy(hre, CONTRACTS.TokenMinter);

        const tokenMinter = await getTypedContract(hre, CONTRACTS.TokenMinter);
        await (await tokenMinter.initialize(taskArgs.timelock)).wait();

        const coupon = await getTypedContract(hre, CONTRACTS.TradingFeeCoupon);
        if (await coupon.hasRole(DEFAULT_ADMIN_ROLE, deployer)) {
            await (await coupon.grantRole(MINTER_ROLE, tokenMinter)).wait();
        } else {
            console.log(`to: ${await coupon.getAddress()}`);
            console.log(coupon.interface.getFunction("grantRole").format());
            console.log(MINTER_ROLE);
            console.log(await tokenMinter.getAddress());
            console.log(`data: ${coupon.interface.encodeFunctionData("grantRole", [MINTER_ROLE, tokenMinter])}`);
        }
    });
