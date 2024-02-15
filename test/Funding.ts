import hre, { deployments } from "hardhat";
import { expect } from "chai";
import { CONTRACTS, MAX_UINT256, getProxyContract, normalized, usdcOf } from "../src/utils/utils";
import { DAY, increaseNextBlockTimestamp, setPythAutoRefresh, setupPrices } from "../src/utils/test_utils";
import { ethers } from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { NetworkConfigs, getConfig } from "../src/config";

const chainlinkPrices: { [key: string]: number } = {
    Sequencer: 0,
    USDC: 1,
    WETH: 1000,
    WBTC: 10000,
};

const pythPrices: { [key: string]: number } = {
    USDC: 1,
    WETH: 1000,
    WBTC: 10000,
};

describe("Funding", () => {
    let account1: ethers.Signer;
    let account2: ethers.Signer;
    let deployer: ethers.Signer;
    let config: NetworkConfigs;
    let market_: ethers.Contract;
    let perpTracker_: ethers.Contract;
    let positionManager_: ethers.Contract;
    let liquidityManager_: ethers.Contract;
    let marketSettings_: ethers.Contract;
    let WETH: string;
    let USDC_: ethers.Contract;

    before(async () => {
        deployer = (await hre.ethers.getSigners())[0];
        account1 = (await hre.ethers.getSigners())[1];
        account2 = (await hre.ethers.getSigners())[2];
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH = await (await hre.ethers.getContract("WETH")).getAddress();
        USDC_ = await hre.ethers.getContract("USDC", deployer);
        market_ = await getProxyContract(hre, CONTRACTS.Market, account1);
        perpTracker_ = await getProxyContract(hre, CONTRACTS.PerpTracker, account1);
        marketSettings_ = await getProxyContract(hre, CONTRACTS.MarketSettings, deployer);
        liquidityManager_ = await getProxyContract(hre, CONTRACTS.LiquidityManager, account1);
        positionManager_ = await getProxyContract(hre, CONTRACTS.PositionManager, account1);
        config = getConfig(hre.network.name);

        await (await USDC_.transfer(await account1.getAddress(), usdcOf(100000000))).wait();
        await (await USDC_.transfer(await account2.getAddress(), usdcOf(100000000))).wait();

        // add liquidity
        USDC_ = USDC_.connect(account1);
        await (await USDC_.approve(await market_.getAddress(), MAX_UINT256)).wait();
        const amount = usdcOf(1000000); // 1M
        const minLp = normalized(100000);
        await (await liquidityManager_.addLiquidity(amount, minLp, await account1.getAddress(), false)).wait();

        await (await USDC_.connect(account2).approve(await market_.getAddress(), MAX_UINT256)).wait();

        await (
            await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxFundingVelocity")], [normalized(0.2)])
        ).wait();
        // set financing fee rate, trading fee to zero
        await (await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxFinancingFeeRate")], [0])).wait();
        await (await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("perpTradingFee")], [0])).wait();
        // for convenience of following test, set divergence to 200%
        await (
            await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxPriceDivergence")], [normalized(2)])
        ).wait();
        await (
            await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("pythMaxAge")], [normalized(10000)])
        ).wait();
        // set slippage to zero
        await (await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("liquidityRange")], [0])).wait();
        // set veSYM incentive ratio to 10%
        await (
            await marketSettings_.setIntVals(
                [hre.ethers.encodeBytes32String("veSYMFeeIncentiveRatio")],
                [normalized(0.1)]
            )
        ).wait();
        await setPythAutoRefresh(hre);
    });

    it("open ETH long, keep it for 1 day", async () => {
        positionManager_ = positionManager_.connect(account1);
        // deposit margins
        await (
            await positionManager_.depositMargin(await USDC_.getAddress(), usdcOf(10000), hre.ethers.ZeroHash)
        ).wait();

        // open eth long, 50000 notional
        await (
            await positionManager_.submitOrder([
                WETH,
                normalized(50),
                normalized(1000),
                usdcOf(1),
                (await helpers.time.latest()) + 100,
                false,
            ])
        ).wait();
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await expect(positionManager_.executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(
                await account1.getAddress(),
                WETH,
                normalized(50),
                normalized(1000),
                normalized(0),
                normalized(0),
                orderId
            );

        expect(await perpTracker_.nextFundingVelocity(WETH)).to.deep.eq(normalized(0.01));
        await increaseNextBlockTimestamp(DAY);
        await helpers.mine(1);
        expect(await perpTracker_.nextFundingVelocity(WETH)).to.deep.eq(normalized(0.01));
        const fs = await perpTracker_.nextAccFunding(WETH, normalized(1000));
        expect(fs[0]).to.deep.eq(normalized(0.01));
        expect(fs[1]).to.deep.eq(normalized(5));
    });
    it("open ETH short, filp the skew", async () => {
        const evmTime = BigInt(await helpers.time.latest());
        await increaseNextBlockTimestamp(1);
        // open eth short, 100000 notional
        await (
            await positionManager_.submitOrder([
                WETH,
                normalized(-100),
                normalized(1000),
                usdcOf(1),
                evmTime + 2n * DAY,
                false,
            ])
        ).wait();
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(DAY - 1n); // 2 days since long position opened

        await expect(positionManager_.executeOrder(orderId, []))
            .to.emit(market_, "Traded")
            .withArgs(
                await account1.getAddress(),
                WETH,
                normalized(-100),
                normalized(1000),
                normalized(0),
                normalized(0),
                orderId
            );

        expect(await perpTracker_.nextFundingVelocity(WETH)).to.deep.eq("-9990009990009990");
        let fs = await perpTracker_.nextAccFunding(WETH, normalized(1000));
        expect(fs[0]).to.deep.eq(normalized(0.02));
        expect(fs[1]).to.deep.eq(normalized(20));

        await increaseNextBlockTimestamp(DAY);

        await helpers.mine(1);
        fs = await perpTracker_.nextAccFunding(WETH, normalized(1000));
        expect(fs[0]).to.deep.eq("19980019980020");

        await increaseNextBlockTimestamp(DAY);
        await helpers.mine(1);
        fs = await perpTracker_.nextAccFunding(WETH, normalized(1000));
        expect(fs[0]).to.deep.eq("-9980019980019979");
        expect(fs[1]).to.deep.eq("25024980019980020000");
    });
});
