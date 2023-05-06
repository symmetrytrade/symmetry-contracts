import hre, { deployments } from "hardhat";
import { expect } from "chai";
import {
    ADDR0,
    CONTRACTS,
    MAX_UINT256,
    UNIT,
    getProxyContract,
    normalized,
} from "../src/utils/utils";
import {
    getPythUpdateData,
    increaseNextBlockTimestamp,
    printValues,
    setupPrices,
} from "../src/utils/test_utils";
import { ethers } from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { NetworkConfigs, getConfig } from "../src/config";

const chainlinkPrices: { [key: string]: number } = {
    Sequencer: 0,
    USDC: 0.98,
    WETH: 1500,
    WBTC: 20000,
};

const pythPrices: { [key: string]: number } = {
    USDC: 0.98,
    WETH: 1500,
    WBTC: 20000,
};

describe("Liquidity", () => {
    let account1: ethers.Signer;
    let deployer: ethers.Signer;
    let config: NetworkConfigs;
    let market_: ethers.Contract;
    let perpTracker_: ethers.Contract;
    let positionManager_: ethers.Contract;
    let liquidityManager_: ethers.Contract;
    let lpToken_: ethers.Contract;
    let WETH: string;
    let WBTC: string;
    let USDC_: ethers.Contract;

    before(async () => {
        deployer = (await hre.ethers.getSigners())[0];
        account1 = (await hre.ethers.getSigners())[1];
        await deployments.fixture();
        await setupPrices(hre, chainlinkPrices, pythPrices, account1);
        WETH = (await hre.ethers.getContract("WETH")).address;
        WBTC = (await hre.ethers.getContract("WBTC")).address;
        USDC_ = await hre.ethers.getContract("USDC", deployer);
        market_ = await getProxyContract(hre, CONTRACTS.Market, account1);
        lpToken_ = await getProxyContract(hre, CONTRACTS.LPToken, account1);
        perpTracker_ = await getProxyContract(
            hre,
            CONTRACTS.PerpTracker,
            account1
        );
        liquidityManager_ = await getProxyContract(
            hre,
            CONTRACTS.LiquidityManager,
            account1
        );
        positionManager_ = await getProxyContract(
            hre,
            CONTRACTS.PositionManager,
            account1
        );
        config = getConfig(hre.network.name);

        await (
            await USDC_.transfer(
                await account1.getAddress(),
                hre.ethers.BigNumber.from(10000000).mul(UNIT)
            )
        ).wait();
    });

    it("deposit&remove at zero skew", async () => {
        // deposit
        USDC_ = USDC_.connect(account1);
        await (await USDC_.approve(market_.address, MAX_UINT256)).wait();
        const amount = hre.ethers.BigNumber.from(100000).mul(UNIT);
        const minUsd = hre.ethers.BigNumber.from(98000).mul(UNIT);
        const minLp = hre.ethers.BigNumber.from(98000).mul(UNIT);
        await expect(
            liquidityManager_.addLiquidity(
                amount,
                minUsd.add(1),
                minLp,
                await account1.getAddress()
            )
        ).to.be.revertedWith("LiquidityManager: insufficient usd amount");
        await expect(
            liquidityManager_.addLiquidity(
                amount,
                minUsd,
                minLp.add(1),
                await account1.getAddress()
            )
        ).to.be.revertedWith("LiquidityManager: insufficient lp amount");
        await expect(
            liquidityManager_.addLiquidity(
                amount,
                minUsd,
                minLp,
                await account1.getAddress()
            )
        )
            .to.emit(liquidityManager_, "AddLiquidity")
            .withArgs(await account1.getAddress(), amount, 0, minUsd, minLp);
        expect(
            await lpToken_.balanceOf(await account1.getAddress())
        ).to.deep.eq(minLp);
        expect(await lpToken_.totalSupply()).to.deep.eq(minLp);
        expect(await USDC_.balanceOf(market_.address)).to.deep.eq(amount);
        expect(
            await liquidityManager_.latestMint(await account1.getAddress())
        ).to.deep.eq(await helpers.time.latest());
        let globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq(minUsd);
        expect(globalStatus.netOpenInterest).to.deep.eq(0);
        // remove
        await expect(
            liquidityManager_.removeLiquidity(
                minLp,
                amount.add(1),
                await account1.getAddress()
            )
        ).to.be.revertedWith("LiquidityManager: insufficient amountOut");
        await expect(
            liquidityManager_.removeLiquidity(
                minLp,
                amount.sub(amount.div(1000)),
                await account1.getAddress()
            )
        )
            .to.emit(liquidityManager_, "RemoveLiquidity")
            .withArgs(
                await account1.getAddress(),
                minLp,
                normalized(98000),
                normalized(98000),
                normalized(98),
                amount.sub(amount.div(1000))
            );
        globalStatus = await market_.globalStatus();
        expect(globalStatus.lpNetValue).to.deep.eq(
            amount.div(1000000).mul(980)
        );
        expect(globalStatus.netOpenInterest).to.deep.eq(0);
        expect(
            await lpToken_.balanceOf(await account1.getAddress())
        ).to.deep.eq(0);
    });

    it("deposit&remove at non-zero skew", async () => {
        // first deposit
        const amount = hre.ethers.BigNumber.from(100000).mul(UNIT);
        const minUsd = hre.ethers.BigNumber.from(98000).mul(UNIT);
        const minLp = hre.ethers.BigNumber.from(98000).mul(UNIT);
        await (
            await liquidityManager_.addLiquidity(
                amount,
                minUsd,
                minLp,
                await account1.getAddress()
            )
        ).wait();
        expect(
            await lpToken_.balanceOf(await account1.getAddress())
        ).to.deep.eq(minLp);

        // trade
        await (
            await positionManager_.depositMargin(
                hre.ethers.BigNumber.from(1500).mul(UNIT),
                hre.ethers.constants.HashZero
            )
        ).wait();
        await (
            await positionManager_.submitOrder(
                WETH,
                normalized(1),
                normalized(1550),
                normalized(1),
                (await helpers.time.latest()) + 100
            )
        ).wait();
        const orderId = (await positionManager_.orderCnt()).sub(1);

        await increaseNextBlockTimestamp(
            config.marketGeneralConfig.minOrderDelay
        ); // 60s

        const pythUpdateData = await getPythUpdateData(hre, { WETH: 1500 });
        await expect(
            positionManager_.executeOrder(orderId, pythUpdateData.updateData, {
                value: pythUpdateData.fee,
            })
        )
            .to.emit(market_, "Traded")
            .withArgs(
                await account1.getAddress(),
                WETH,
                normalized(1),
                "1507239795918367346335", // avg price
                "1505734061856510835", // trading fee
                "0"
            );
        const lpPosition = await perpTracker_.getLpPosition(WETH);
        expect(lpPosition.longSize).to.deep.eq(0);
        expect(lpPosition.shortSize).to.deep.eq(normalized(-1));
        // second deposit
        await increaseNextBlockTimestamp(5); // 5s
        await expect(
            liquidityManager_.addLiquidity(
                amount,
                minUsd,
                0,
                await account1.getAddress()
            )
        )
            .to.emit(liquidityManager_, "AddLiquidity")
            .withArgs(
                await account1.getAddress(),
                amount,
                "98105239807439471352335",
                normalized(98000),
                "97894873085787145653945"
            );
        // first remove
        await increaseNextBlockTimestamp(5); // 5s
        expect(await lpToken_.totalSupply()).to.deep.eq(
            "195894873085787145653945"
        );
        await expect(
            liquidityManager_.removeLiquidity(
                "97947435790888919009027",
                0,
                await account1.getAddress()
            )
        )
            .to.emit(liquidityManager_, "RemoveLiquidity")
            .withArgs(
                await account1.getAddress(),
                "97947435790888919009027",
                "196105239842002783373335",
                "98052619168189178297658",
                "103104401548277725801",
                "99948484455756020991690"
            );
        expect(await lpToken_.totalSupply()).to.deep.eq(
            "97947437294898226644918"
        );
        expect(
            await lpToken_.balanceOf(await account1.getAddress())
        ).to.deep.eq("97947437294898226644918");
        // second remove
        await increaseNextBlockTimestamp(5); // 5s
        await expect(
            liquidityManager_.removeLiquidity(
                normalized(97500),
                0,
                await account1.getAddress()
            )
        ).to.be.revertedWith("LiquidityManager: insufficient free lp");
    });

    it("set functions", async () => {
        liquidityManager_ = liquidityManager_.connect(deployer);
        await liquidityManager_.setMarket(ADDR0, ADDR0);
        expect(await liquidityManager_.market()).to.eq(ADDR0);
        expect(await liquidityManager_.lpToken()).to.eq(ADDR0);
    });
});
