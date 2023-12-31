import hre, { deployments } from "hardhat";
import { expect } from "chai";
import { CONTRACTS, MAX_UINT256, UNIT, getProxyContract, mul_D, normalized, usdcOf } from "../src/utils/utils";
import {
    HOUR,
    getPythUpdateData,
    increaseNextBlockTimestamp,
    setPythAutoRefresh,
    setupPrices,
} from "../src/utils/test_utils";
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

describe("Margin", () => {
    let account1: ethers.Signer;
    let account2: ethers.Signer;
    let liquidator: ethers.Signer;
    let deployer: ethers.Signer;
    let keeper: ethers.Signer;
    let config: NetworkConfigs;
    let market_: ethers.Contract;
    let WBTC_: ethers.Contract;
    let priceOracle_: ethers.Contract;
    let positionManager_: ethers.Contract;
    let liquidityManager_: ethers.Contract;
    let marketSettings_: ethers.Contract;
    let marginTracker_: ethers.Contract;
    let interestRateModel_: ethers.Contract;
    let WETH: string;
    let USDC_: ethers.Contract;
    let debtRatio: ethers.BigNumber;
    let lp: ethers.BigNumber;
    let userMargin: ethers.BigNumber;
    let baseMargin: ethers.BigNumber;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any

    before(async () => {
        deployer = (await hre.ethers.getSigners())[0];
        account1 = (await hre.ethers.getSigners())[1];
        account2 = (await hre.ethers.getSigners())[2];
        liquidator = (await hre.ethers.getSigners())[2];
        keeper = (await hre.ethers.getSigners())[6];
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH = (await hre.ethers.getContract("WETH")).address;
        USDC_ = await hre.ethers.getContract("USDC", deployer);
        WBTC_ = await hre.ethers.getContract("WBTC", deployer);
        market_ = await getProxyContract(hre, CONTRACTS.Market, account1);
        priceOracle_ = await getProxyContract(hre, CONTRACTS.PriceOracle, account1);
        marketSettings_ = await getProxyContract(hre, CONTRACTS.MarketSettings, deployer);
        liquidityManager_ = await getProxyContract(hre, CONTRACTS.LiquidityManager, account1);
        positionManager_ = await getProxyContract(hre, CONTRACTS.PositionManager, account1);
        marginTracker_ = await getProxyContract(hre, CONTRACTS.MarginTracker, account1);
        interestRateModel_ = await getProxyContract(hre, CONTRACTS.DebtInterestRateModel, account1);
        config = getConfig(hre.network.name);

        for (let i = 1; i <= 4; ++i) {
            await (
                await USDC_.transfer(await (await hre.ethers.getSigners())[i].getAddress(), usdcOf(100000000))
            ).wait();
            await (
                await USDC_.connect((await hre.ethers.getSigners())[i]).approve(market_.address, MAX_UINT256)
            ).wait();
            await (
                await WBTC_.transfer(await (await hre.ethers.getSigners())[i].getAddress(), normalized(1000))
            ).wait();
            await (
                await WBTC_.connect((await hre.ethers.getSigners())[i]).approve(market_.address, MAX_UINT256)
            ).wait();
        }

        // add liquidity
        USDC_ = USDC_.connect(account1);
        const amount = usdcOf(1000000); // 1M
        const minLp = normalized(100000);
        await (await liquidityManager_.addLiquidity(amount, minLp, await account1.getAddress(), false)).wait();

        // set fee and slippage to zero for convenience
        await (
            await marketSettings_.setIntVals([hre.ethers.utils.formatBytes32String("maxFundingVelocity")], [0])
        ).wait();
        await (
            await marketSettings_.setIntVals([hre.ethers.utils.formatBytes32String("maxFinancingFeeRate")], [0])
        ).wait();
        await (await marketSettings_.setIntVals([hre.ethers.utils.formatBytes32String("liquidityRange")], [0])).wait();
        await (await marketSettings_.setIntVals([hre.ethers.utils.formatBytes32String("perpTradingFee")], [0])).wait();
        await (
            await marketSettings_.setIntVals([hre.ethers.utils.formatBytes32String("pythMaxAge")], [1000000])
        ).wait();
        await (
            await marketSettings_.setIntVals([hre.ethers.utils.formatBytes32String("minKeeperFee")], [normalized(0)])
        ).wait();
        // set debt interest rate to 0%
        await (await marketSettings_.setIntVals([hre.ethers.utils.formatBytes32String("minInterestRate")], [0])).wait();
        await (await marketSettings_.setIntVals([hre.ethers.utils.formatBytes32String("maxInterestRate")], [0])).wait();
        await (
            await marketSettings_.setIntVals([hre.ethers.utils.formatBytes32String("vertexInterestRate")], [0])
        ).wait();
        await (
            await marketSettings_.setIntVals(
                [hre.ethers.utils.formatBytes32String("maxPriceDivergence")],
                [normalized(1000)]
            )
        ).wait();
        await setPythAutoRefresh(hre);
    });

    it("trade and generate negative margin", async () => {
        // deposit BTC
        await (
            await positionManager_.depositMargin(WBTC_.address, normalized(5), hre.ethers.constants.HashZero)
        ).wait();
        // check margin
        let margin = await marginTracker_.accountMargin(await account1.getAddress());
        expect(margin.otherMargin).to.deep.eq(normalized(5 * 10000 * 0.9));
        expect(margin.baseMargin).to.deep.eq(0);
        let status = await market_.accountMarginStatus(await account1.getAddress());
        expect(status.mtm).to.deep.eq(0);
        expect(status.currentMargin).to.deep.eq(normalized(5 * 10000 * 0.9));
        expect(status.positionNotional).to.deep.eq(0);
        // open eth long, 200000 notional
        await (
            await positionManager_.submitOrder([
                WETH,
                normalized(200),
                normalized(1000),
                usdcOf(0),
                (await helpers.time.latest()) + 100,
                false,
            ])
        ).wait();
        const orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await (await positionManager_.executeOrder(orderId, [])).wait();
        // eth price drop to 500
        const pythUpdateData = await getPythUpdateData(hre, { WETH: 500 });
        await (
            await priceOracle_.updatePythPrice(pythUpdateData.updateData, {
                value: pythUpdateData.fee,
            })
        ).wait();
        // check margin
        margin = await marginTracker_.accountMargin(await account1.getAddress());
        expect(margin.otherMargin).to.deep.eq(normalized(5 * 10000 * 0.9));
        expect(margin.baseMargin).to.deep.eq(0);
        status = await market_.accountMarginStatus(await account1.getAddress());
        expect(status.mtm).to.deep.eq(normalized(500 * 200 * 0.02 + 20));
        expect(status.currentMargin).to.deep.eq(normalized(5 * 10000 * 0.9 - 500 * 200 * 1.2));
        expect(status.positionNotional).to.deep.eq(normalized(500 * 200));
    });
    it("settle, earn keeper fee", async () => {
        let globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq(normalized(1000000 + 500 * 200));
        expect(globalStatus.netOpenInterest).to.deep.eq(normalized(500 * 200));
        expect(globalStatus.netSkew).to.deep.eq(normalized(500 * 200));
        expect(await marginTracker_.userCollaterals(await keeper.getAddress(), USDC_.address)).to.deep.eq(0);
        expect(await marginTracker_.totalDebt()).to.deep.eq(0);
        // set keeper fee to 1 usdc
        await marketSettings_.setIntVals([hre.ethers.utils.formatBytes32String("minKeeperFee")], [usdcOf(1)]);
        // settle
        await market_.connect(keeper).settle(await account1.getAddress(), [WETH, WBTC_.address]);
        const totalDebt = await marginTracker_.totalDebt();
        expect(totalDebt).to.deep.eq(usdcOf(200 * 500));
        expect(await marginTracker_.userCollaterals(await keeper.getAddress(), USDC_.address)).to.deep.eq(usdcOf(1));
        // check lp
        globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq(normalized(1000000 + 500 * 200 - 1));
        expect(globalStatus.netOpenInterest).to.deep.eq(normalized(500 * 200));
        expect(globalStatus.netSkew).to.deep.eq(normalized(500 * 200));
        lp = globalStatus.lpNetValue;
        // check account1
        const margin = await marginTracker_.accountMargin(await account1.getAddress());
        expect(margin.otherMargin).to.deep.eq(normalized(5 * 10000 * 0.9));
        expect(margin.baseMargin).to.deep.eq(normalized(-500 * 200));
        const status = await market_.accountMarginStatus(await account1.getAddress());
        expect(status.mtm).to.deep.eq(normalized(500 * 200 * 0.02 + 20));
        expect(status.currentMargin).to.deep.eq(normalized(5 * 10000 * 0.9 - 500 * 200 * 1.2));
        expect(status.positionNotional).to.deep.eq(normalized(500 * 200));
        userMargin = status.currentMargin;
        // check interest rate model
        expect(await interestRateModel_.totalDebt()).to.deep.eq(totalDebt);
        debtRatio = totalDebt
            .mul(1e12)
            .mul(UNIT)
            .div(globalStatus.lpNetValue.add(normalized(1)).sub(globalStatus.netSkew));
        expect(await interestRateModel_.debtRatio()).to.deep.eq(debtRatio);
    });
    it("pay debt, deposit USDC", async () => {
        // set debt interest rate to 0%
        await (
            await marketSettings_.setIntVals(
                [hre.ethers.utils.formatBytes32String("minInterestRate")],
                [config.marketGeneralConfig.minInterestRate]
            )
        ).wait();
        await (
            await marketSettings_.setIntVals(
                [hre.ethers.utils.formatBytes32String("maxInterestRate")],
                [config.marketGeneralConfig.maxInterestRate]
            )
        ).wait();
        await (
            await marketSettings_.setIntVals(
                [hre.ethers.utils.formatBytes32String("vertexInterestRate")],
                [config.marketGeneralConfig.vertexInterestRate]
            )
        ).wait();

        await marketSettings_.setIntVals([hre.ethers.utils.formatBytes32String("minKeeperFee")], [0]);
        await increaseNextBlockTimestamp(HOUR);
        await helpers.mine();
        const interest = await interestRateModel_.nextInterest();
        // check lp
        let globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq(lp.add(interest.mul(1e12)));
        lp = globalStatus.lpNetValue;
        expect(globalStatus.netOpenInterest).to.deep.eq(normalized(500 * 200));
        expect(globalStatus.netSkew).to.deep.eq(normalized(500 * 200));
        // check account1
        let margin = await marginTracker_.accountMargin(await account1.getAddress());
        expect(margin.otherMargin).to.deep.eq(normalized(5 * 10000 * 0.9));
        baseMargin = ethers.BigNumber.from(normalized(-500 * 200)).sub(interest.mul(1e12));
        expect(margin.baseMargin).to.deep.eq(baseMargin);
        let status = await market_.accountMarginStatus(await account1.getAddress());
        userMargin = userMargin.sub(mul_D(interest.mul(1e12), ethers.BigNumber.from(normalized(1.2))));
        expect(status.currentMargin).to.deep.eq(userMargin);
        // accDebt
        expect(await marginTracker_.accDebt()).to.deep.eq(0);
        expect(await marginTracker_.unsettledInterest()).to.deep.eq(0);
        expect(await marginTracker_.userAccDebts(await account1.getAddress())).to.deep.eq(0);
        // settle debt
        await helpers.time.setNextBlockTimestamp(await helpers.time.latest());
        await market_.connect(keeper).settle(await account1.getAddress(), [WETH, WBTC_.address]);
        // check lp
        globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq(lp);
        expect(globalStatus.netOpenInterest).to.deep.eq(normalized(500 * 200));
        expect(globalStatus.netSkew).to.deep.eq(normalized(500 * 200));
        // check account1
        margin = await marginTracker_.accountMargin(await account1.getAddress());
        expect(margin.otherMargin).to.deep.eq(normalized(5 * 10000 * 0.9));
        expect(margin.baseMargin).to.deep.eq(baseMargin);
        status = await market_.accountMarginStatus(await account1.getAddress());
        expect(status.currentMargin).to.deep.eq(userMargin);
        // debt
        expect(await marginTracker_.accDebt()).to.deep.eq(
            await marginTracker_.userAccDebts(await account1.getAddress())
        );
        expect(await marginTracker_.unsettledInterest()).to.deep.eq(0);
        let totalDebt = ethers.BigNumber.from(usdcOf(500 * 200)).add(interest);
        expect(await marginTracker_.totalDebt()).to.deep.eq(totalDebt);
        expect(await interestRateModel_.totalDebt()).to.deep.eq(totalDebt);
        // deposit USDC
        await helpers.time.setNextBlockTimestamp(await helpers.time.latest());
        await (await positionManager_.depositMargin(USDC_.address, usdcOf(5000), hre.ethers.constants.HashZero)).wait();
        // check lp
        globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq(lp);
        expect(globalStatus.netOpenInterest).to.deep.eq(normalized(500 * 200));
        expect(globalStatus.netSkew).to.deep.eq(normalized(500 * 200));
        // check account1
        margin = await marginTracker_.accountMargin(await account1.getAddress());
        expect(margin.otherMargin).to.deep.eq(normalized(5 * 10000 * 0.9));
        baseMargin = baseMargin.add(normalized(5000));
        expect(margin.baseMargin).to.deep.eq(baseMargin);
        status = await market_.accountMarginStatus(await account1.getAddress());
        userMargin = userMargin.add(normalized(5000 * 1.2));
        expect(status.currentMargin).to.deep.eq(userMargin);
        // debt
        expect(await marginTracker_.accDebt()).to.deep.eq(
            await marginTracker_.userAccDebts(await account1.getAddress())
        );
        totalDebt = totalDebt.sub(usdcOf(5000));
        expect(await marginTracker_.unsettledInterest()).to.deep.eq(0);
        expect(await marginTracker_.totalDebt()).to.deep.eq(totalDebt);
        expect(await interestRateModel_.totalDebt()).to.deep.eq(totalDebt);
    });
    it("liquidate, generate deficit loss", async () => {
        await helpers.time.setNextBlockTimestamp(await helpers.time.latest());
        // liquidate position
        await expect(positionManager_.connect(liquidator).liquidatePosition(await account1.getAddress(), WETH, []))
            .to.emit(positionManager_, "Liquidated")
            .withArgs(
                await account1.getAddress(),
                WETH,
                normalized(200),
                normalized(200 * 500),
                normalized(350),
                normalized(1000),
                0
            )
            .to.emit(positionManager_, "LiquidationFee")
            .withArgs(await account1.getAddress(), normalized(200 * 500), normalized(350), usdcOf(350))
            .to.emit(positionManager_, "LiquidationPenalty")
            .withArgs(await account1.getAddress(), normalized(200 * 500), normalized(1000), usdcOf(1000));
        // check lp
        let globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq(lp);
        expect(globalStatus.netOpenInterest).to.deep.eq(0);
        expect(globalStatus.netSkew).to.deep.eq(0);
        // insurance
        const insurance = await market_.insuranceBalance();
        expect(insurance).to.deep.eq(usdcOf(1000));
        // check account1
        let margin = await marginTracker_.accountMargin(await account1.getAddress());
        expect(margin.otherMargin).to.deep.eq(normalized(5 * 10000 * 0.9));
        baseMargin = baseMargin.sub(normalized(350)).sub(normalized(1000));
        expect(margin.baseMargin).to.deep.eq(baseMargin);
        let status = await market_.accountMarginStatus(await account1.getAddress());
        userMargin = userMargin.sub(normalized((350 + 1000) * 1.2));
        expect(status.currentMargin).to.deep.eq(userMargin);
        // liquidate collaterals
        const liquidatorBTC = await WBTC_.balanceOf(await liquidator.getAddress());
        const liquidatorUSDC = await USDC_.balanceOf(await liquidator.getAddress());
        const marketUSDC = await USDC_.balanceOf(market_.address);
        const marketBTC = await WBTC_.balanceOf(market_.address);
        await helpers.time.setNextBlockTimestamp(await helpers.time.latest());
        const amount = usdcOf(50000 * 0.99);
        const loss = baseMargin.div(1e12).add(amount).mul(-1);
        await expect(marginTracker_.connect(liquidator).liquidate(await account1.getAddress(), WBTC_.address, amount))
            .to.emit(marginTracker_, "Liquidated")
            .withArgs(await account1.getAddress(), WBTC_.address, normalized(5), amount, 0, 0, loss)
            .to.emit(marginTracker_, "DeficitLoss")
            .withArgs(await account1.getAddress(), loss, insurance, loss.sub(insurance));
        expect(await WBTC_.balanceOf(await liquidator.getAddress())).to.deep.eq(liquidatorBTC.add(normalized(5)));
        expect(await USDC_.balanceOf(await liquidator.getAddress())).to.deep.eq(liquidatorUSDC.sub(amount));
        expect(await USDC_.balanceOf(market_.address)).to.deep.eq(marketUSDC.add(amount));
        expect(await WBTC_.balanceOf(market_.address)).to.deep.eq(marketBTC.sub(normalized(5)));
        // check lp
        globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq(lp.sub(loss.sub(insurance).mul(1e12)));
        expect(globalStatus.netOpenInterest).to.deep.eq(0);
        expect(globalStatus.netSkew).to.deep.eq(0);
        // insurance
        expect(await market_.insuranceBalance()).to.deep.eq(0);
        // check account1
        margin = await marginTracker_.accountMargin(await account1.getAddress());
        expect(margin.otherMargin).to.deep.eq(0);
        expect(margin.baseMargin).to.deep.eq(0);
        status = await market_.accountMarginStatus(await account1.getAddress());
        expect(status.currentMargin).to.deep.eq(0);
        // check interest rate model
        expect(await marginTracker_.totalDebt()).to.deep.eq(0);
        expect(await interestRateModel_.totalDebt()).to.deep.eq(0);
        expect(await interestRateModel_.debtRatio()).to.deep.eq(0);
    });
    it("deposit&withdraw WETH", async () => {
        positionManager_ = positionManager_.connect(account2);
        // deposit WETH
        await (
            await positionManager_.depositMargin(WETH, normalized(1), hre.ethers.constants.HashZero, {
                value: normalized(1),
            })
        ).wait();
        expect(await marginTracker_.userCollaterals(await account2.getAddress(), WETH)).to.deep.eq(normalized(1));
        // withdraw WETH
        const balanceBefore = await hre.ethers.provider.getBalance(account2.getAddress());
        // set next block gas price to 0
        await helpers.setNextBlockBaseFeePerGas(0);
        await (await positionManager_.withdrawMarginETH(normalized(1), { gasPrice: 0 })).wait();
        expect(await marginTracker_.userCollaterals(await account2.getAddress(), WETH)).to.deep.eq(0);
        const balanceAfter = await hre.ethers.provider.getBalance(account2.getAddress());
        expect(balanceAfter.sub(balanceBefore)).to.deep.eq(normalized(1));
    });
});
