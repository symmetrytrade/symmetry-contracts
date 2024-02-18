import hre, { deployments } from "hardhat";
import { expect } from "chai";
import { CONTRACTS, MAX_UINT256, UNIT, getTypedContract, mul_D, normalized, usdcOf } from "../src/utils/utils";
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
import {
    DebtInterestRateModel,
    FaucetToken,
    LiquidityManager,
    MarginTracker,
    Market,
    MarketSettings,
    PositionManager,
    PriceOracle,
} from "../typechain-types";

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
    let keeper: ethers.Signer;
    let config: NetworkConfigs;
    let market_: Market;
    let WBTC_: FaucetToken;
    let priceOracle_: PriceOracle;
    let positionManager_: PositionManager;
    let liquidityManager_: LiquidityManager;
    let marketSettings_: MarketSettings;
    let marginTracker_: MarginTracker;
    let interestRateModel_: DebtInterestRateModel;
    let WETH: string;
    let USDC_: FaucetToken;
    let debtRatio: bigint;
    let lp: bigint;
    let userMargin: bigint;
    let baseMargin: bigint;

    before(async () => {
        account1 = (await hre.ethers.getSigners())[1];
        account2 = (await hre.ethers.getSigners())[2];
        liquidator = (await hre.ethers.getSigners())[2];
        keeper = (await hre.ethers.getSigners())[6];
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH = await (await getTypedContract(hre, CONTRACTS.WETH)).getAddress();
        USDC_ = await getTypedContract(hre, CONTRACTS.USDC);
        WBTC_ = await getTypedContract(hre, CONTRACTS.WBTC);
        market_ = await getTypedContract(hre, CONTRACTS.Market, account1);
        priceOracle_ = await getTypedContract(hre, CONTRACTS.PriceOracle, account1);
        marketSettings_ = await getTypedContract(hre, CONTRACTS.MarketSettings);
        liquidityManager_ = await getTypedContract(hre, CONTRACTS.LiquidityManager, account1);
        positionManager_ = await getTypedContract(hre, CONTRACTS.PositionManager, account1);
        marginTracker_ = await getTypedContract(hre, CONTRACTS.MarginTracker, account1);
        interestRateModel_ = await getTypedContract(hre, CONTRACTS.DebtInterestRateModel, account1);
        config = getConfig(hre.network.name);

        for (let i = 1; i <= 4; ++i) {
            await USDC_.transfer(await (await hre.ethers.getSigners())[i].getAddress(), usdcOf(100000000));
            await USDC_.connect((await hre.ethers.getSigners())[i]).approve(await market_.getAddress(), MAX_UINT256);
            await WBTC_.transfer(await (await hre.ethers.getSigners())[i].getAddress(), normalized(1000));
            await WBTC_.connect((await hre.ethers.getSigners())[i]).approve(await market_.getAddress(), MAX_UINT256);
        }

        // add liquidity
        USDC_ = USDC_.connect(account1);
        const amount = usdcOf(1000000); // 1M
        const minLp = normalized(100000);
        await liquidityManager_.addLiquidity(amount, minLp, await account1.getAddress(), false);

        // set fee and slippage to zero for convenience
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxFundingVelocity")], [0]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxFinancingFeeRate")], [0]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("liquidityRange")], [0]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("perpTradingFee")], [0]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("pythMaxAge")], [1000000]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("minKeeperFee")], [normalized(0)]);
        // set debt interest rate to 0%
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("minInterestRate")], [0]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxInterestRate")], [0]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("vertexInterestRate")], [0]);
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("maxPriceDivergence")], [normalized(1000)]);
        await setPythAutoRefresh(hre);
    });

    it("trade and generate negative margin", async () => {
        // deposit BTC
        await positionManager_.depositMargin(await WBTC_.getAddress(), normalized(5), hre.ethers.ZeroHash);
        // check margin
        let margin = await marginTracker_.accountMargin(await account1.getAddress());
        expect(margin.otherMargin).to.eq(normalized(5 * 10000 * 0.9));
        expect(margin.baseMargin).to.eq(0);
        let status = await market_.accountMarginStatus(await account1.getAddress());
        expect(status.mtm).to.eq(0);
        expect(status.currentMargin).to.eq(normalized(5 * 10000 * 0.9));
        expect(status.positionNotional).to.eq(0);
        // open eth long, 200000 notional
        await positionManager_.submitOrder({
            token: WETH,
            size: normalized(200),
            acceptablePrice: normalized(1000),
            keeperFee: usdcOf(0),
            expiry: (await helpers.time.latest()) + 100,
            reduceOnly: false,
        });
        const orderId = (await positionManager_.orderCnt()) - 1n;

        await increaseNextBlockTimestamp(config.marketGeneralConfig.minOrderDelay); // 60s

        await positionManager_.executeOrder(orderId, []);
        // eth price drop to 500
        const pythUpdateData = await getPythUpdateData(hre, { WETH: 500 });
        await priceOracle_.updatePythPrice(pythUpdateData.updateData, {
            value: pythUpdateData.fee,
        });
        // check margin
        margin = await marginTracker_.accountMargin(await account1.getAddress());
        expect(margin.otherMargin).to.eq(normalized(5 * 10000 * 0.9));
        expect(margin.baseMargin).to.eq(0);
        status = await market_.accountMarginStatus(await account1.getAddress());
        expect(status.mtm).to.eq(normalized(500 * 200 * 0.02 + 20));
        expect(status.currentMargin).to.eq(normalized(5 * 10000 * 0.9 - 500 * 200 * 1.2));
        expect(status.positionNotional).to.eq(normalized(500 * 200));
    });
    it("settle, earn keeper fee", async () => {
        let globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.eq(normalized(1000000 + 500 * 200));
        expect(globalStatus.netOpenInterest).to.eq(normalized(500 * 200));
        expect(globalStatus.netSkew).to.eq(normalized(500 * 200));
        expect(await marginTracker_.userCollaterals(await keeper.getAddress(), await USDC_.getAddress())).to.eq(0);
        expect(await marginTracker_.totalDebt()).to.eq(0);
        // set keeper fee to 1 usdc
        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("minKeeperFee")], [usdcOf(1)]);
        // settle
        await market_.connect(keeper).settle(await account1.getAddress(), [WETH, await WBTC_.getAddress()]);
        const totalDebt = await marginTracker_.totalDebt();
        expect(totalDebt).to.eq(usdcOf(200 * 500));
        expect(await marginTracker_.userCollaterals(await keeper.getAddress(), await USDC_.getAddress())).to.eq(
            usdcOf(1)
        );
        // check lp
        globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.eq(normalized(1000000 + 500 * 200 - 1));
        expect(globalStatus.netOpenInterest).to.eq(normalized(500 * 200));
        expect(globalStatus.netSkew).to.eq(normalized(500 * 200));
        lp = globalStatus.lpNetValue;
        // check account1
        const margin = await marginTracker_.accountMargin(await account1.getAddress());
        expect(margin.otherMargin).to.eq(normalized(5 * 10000 * 0.9));
        expect(margin.baseMargin).to.eq(normalized(-500 * 200));
        const status = await market_.accountMarginStatus(await account1.getAddress());
        expect(status.mtm).to.eq(normalized(500 * 200 * 0.02 + 20));
        expect(status.currentMargin).to.eq(normalized(5 * 10000 * 0.9 - 500 * 200 * 1.2));
        expect(status.positionNotional).to.eq(normalized(500 * 200));
        userMargin = status.currentMargin;
        // check interest rate model
        expect(await interestRateModel_.totalDebt()).to.eq(totalDebt);
        debtRatio = (totalDebt * 10n ** 12n * UNIT) / (globalStatus.lpNetValue + UNIT - globalStatus.netSkew);
        expect(await interestRateModel_.debtRatio()).to.eq(debtRatio);
    });
    it("pay debt, deposit USDC", async () => {
        // set debt interest rate to 0%
        await marketSettings_.setIntVals(
            [hre.ethers.encodeBytes32String("minInterestRate")],
            [config.marketGeneralConfig.minInterestRate]
        );
        await marketSettings_.setIntVals(
            [hre.ethers.encodeBytes32String("maxInterestRate")],
            [config.marketGeneralConfig.maxInterestRate]
        );
        await marketSettings_.setIntVals(
            [hre.ethers.encodeBytes32String("vertexInterestRate")],
            [config.marketGeneralConfig.vertexInterestRate]
        );

        await marketSettings_.setIntVals([hre.ethers.encodeBytes32String("minKeeperFee")], [0]);
        await increaseNextBlockTimestamp(HOUR);
        await helpers.mine();
        const interest = await interestRateModel_.nextInterest();
        // check lp
        let globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.eq(lp + interest * 10n ** 12n);
        lp = globalStatus.lpNetValue;
        expect(globalStatus.netOpenInterest).to.eq(normalized(500 * 200));
        expect(globalStatus.netSkew).to.eq(normalized(500 * 200));
        // check account1
        let margin = await marginTracker_.accountMargin(await account1.getAddress());
        expect(margin.otherMargin).to.eq(normalized(5 * 10000 * 0.9));
        baseMargin = BigInt(normalized(-500 * 200)) - interest * 10n ** 12n;
        expect(margin.baseMargin).to.eq(baseMargin);
        let status = await market_.accountMarginStatus(await account1.getAddress());
        userMargin = userMargin - mul_D(interest * 10n ** 12n, BigInt(normalized(1.2)));
        expect(status.currentMargin).to.eq(userMargin);
        // accDebt
        expect(await marginTracker_.accDebt()).to.eq(0);
        expect(await marginTracker_.unsettledInterest()).to.eq(0);
        expect(await marginTracker_.userAccDebts(await account1.getAddress())).to.eq(0);
        // settle debt
        await helpers.time.setNextBlockTimestamp(await helpers.time.latest());
        await market_.connect(keeper).settle(await account1.getAddress(), [WETH, await WBTC_.getAddress()]);
        // check lp
        globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.eq(lp);
        expect(globalStatus.netOpenInterest).to.eq(normalized(500 * 200));
        expect(globalStatus.netSkew).to.eq(normalized(500 * 200));
        // check account1
        margin = await marginTracker_.accountMargin(await account1.getAddress());
        expect(margin.otherMargin).to.eq(normalized(5 * 10000 * 0.9));
        expect(margin.baseMargin).to.eq(baseMargin);
        status = await market_.accountMarginStatus(await account1.getAddress());
        expect(status.currentMargin).to.eq(userMargin);
        // debt
        expect(await marginTracker_.accDebt()).to.eq(await marginTracker_.userAccDebts(await account1.getAddress()));
        expect(await marginTracker_.unsettledInterest()).to.eq(0);
        let totalDebt = BigInt(usdcOf(500 * 200)) + interest;
        expect(await marginTracker_.totalDebt()).to.eq(totalDebt);
        expect(await interestRateModel_.totalDebt()).to.eq(totalDebt);
        // deposit USDC
        await helpers.time.setNextBlockTimestamp(await helpers.time.latest());
        await positionManager_.depositMargin(await USDC_.getAddress(), usdcOf(5000), hre.ethers.ZeroHash);
        // check lp
        globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.eq(lp);
        expect(globalStatus.netOpenInterest).to.eq(normalized(500 * 200));
        expect(globalStatus.netSkew).to.eq(normalized(500 * 200));
        // check account1
        margin = await marginTracker_.accountMargin(await account1.getAddress());
        expect(margin.otherMargin).to.eq(normalized(5 * 10000 * 0.9));
        baseMargin = baseMargin + BigInt(normalized(5000));
        expect(margin.baseMargin).to.eq(baseMargin);
        status = await market_.accountMarginStatus(await account1.getAddress());
        userMargin = userMargin + BigInt(normalized(5000 * 1.2));
        expect(status.currentMargin).to.eq(userMargin);
        // debt
        expect(await marginTracker_.accDebt()).to.eq(await marginTracker_.userAccDebts(await account1.getAddress()));
        totalDebt = totalDebt - BigInt(usdcOf(5000));
        expect(await marginTracker_.unsettledInterest()).to.eq(0);
        expect(await marginTracker_.totalDebt()).to.eq(totalDebt);
        expect(await interestRateModel_.totalDebt()).to.eq(totalDebt);
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
        expect(globalStatus.lpNetValue).to.eq(lp);
        expect(globalStatus.netOpenInterest).to.eq(0);
        expect(globalStatus.netSkew).to.eq(0);
        // insurance
        const insurance = await market_.insuranceBalance();
        expect(insurance).to.eq(usdcOf(1000));
        // check account1
        let margin = await marginTracker_.accountMargin(await account1.getAddress());
        expect(margin.otherMargin).to.eq(normalized(5 * 10000 * 0.9));
        baseMargin = baseMargin - BigInt(normalized(350)) - BigInt(normalized(1000));
        expect(margin.baseMargin).to.eq(baseMargin);
        let status = await market_.accountMarginStatus(await account1.getAddress());
        userMargin = userMargin - BigInt(normalized((350 + 1000) * 1.2));
        expect(status.currentMargin).to.eq(userMargin);
        // liquidate collaterals
        const liquidatorBTC = await WBTC_.balanceOf(await liquidator.getAddress());
        const liquidatorUSDC = await USDC_.balanceOf(await liquidator.getAddress());
        const marketUSDC = await USDC_.balanceOf(await market_.getAddress());
        const marketBTC = await WBTC_.balanceOf(await market_.getAddress());
        await helpers.time.setNextBlockTimestamp(await helpers.time.latest());
        const amount = BigInt(usdcOf(50000 * 0.99));
        const loss = -(baseMargin / 10n ** 12n + amount);
        await expect(
            marginTracker_.connect(liquidator).liquidate(await account1.getAddress(), await WBTC_.getAddress(), amount)
        )
            .to.emit(marginTracker_, "Liquidated")
            .withArgs(await account1.getAddress(), await WBTC_.getAddress(), normalized(5), amount, 0, 0, loss)
            .to.emit(marginTracker_, "DeficitLoss")
            .withArgs(await account1.getAddress(), loss, insurance, loss - insurance);
        expect(await WBTC_.balanceOf(await liquidator.getAddress())).to.eq(liquidatorBTC + BigInt(normalized(5)));
        expect(await USDC_.balanceOf(await liquidator.getAddress())).to.eq(liquidatorUSDC - amount);
        expect(await USDC_.balanceOf(await market_.getAddress())).to.eq(marketUSDC + amount);
        expect(await WBTC_.balanceOf(await market_.getAddress())).to.eq(marketBTC - BigInt(normalized(5)));
        // check lp
        globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.eq(lp - (loss - insurance) * 10n ** 12n);
        expect(globalStatus.netOpenInterest).to.eq(0);
        expect(globalStatus.netSkew).to.eq(0);
        // insurance
        expect(await market_.insuranceBalance()).to.eq(0);
        // check account1
        margin = await marginTracker_.accountMargin(await account1.getAddress());
        expect(margin.otherMargin).to.eq(0);
        expect(margin.baseMargin).to.eq(0);
        status = await market_.accountMarginStatus(await account1.getAddress());
        expect(status.currentMargin).to.eq(0);
        // check interest rate model
        expect(await marginTracker_.totalDebt()).to.eq(0);
        expect(await interestRateModel_.totalDebt()).to.eq(0);
        expect(await interestRateModel_.debtRatio()).to.eq(0);
    });
    it("deposit&withdraw WETH", async () => {
        positionManager_ = positionManager_.connect(account2);
        // deposit WETH
        await positionManager_.depositMargin(WETH, normalized(1), hre.ethers.ZeroHash, {
            value: normalized(1),
        });
        expect(await marginTracker_.userCollaterals(await account2.getAddress(), WETH)).to.eq(normalized(1));
        // withdraw WETH
        const balanceBefore = await hre.ethers.provider.getBalance(account2.getAddress());
        // set next block gas price to 0
        await helpers.setNextBlockBaseFeePerGas(0);
        await positionManager_.withdrawMarginETH(normalized(1), { gasPrice: 0 });
        expect(await marginTracker_.userCollaterals(await account2.getAddress(), WETH)).to.eq(0);
        const balanceAfter = await hre.ethers.provider.getBalance(account2.getAddress());
        expect(balanceAfter - balanceBefore).to.eq(normalized(1));
    });
});
