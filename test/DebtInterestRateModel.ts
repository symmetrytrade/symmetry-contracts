import hre, { deployments } from "hardhat";
import { expect } from "chai";
import { CONTRACTS, UNIT, div_D, getProxyContract, mul_D, normalized } from "../src/utils/utils";
import { DAY, HOUR } from "../src/utils/test_utils";
import { ethers } from "ethers";
import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { getConfig } from "../src/config";

describe("Debt", () => {
    let account1: ethers.Signer;
    let market_: ethers.Contract;
    let interestRateModel_: ethers.Contract;
    let totalDebt: bigint;
    let debtRatio: bigint;
    let vertexDebtRatio: bigint;
    let vertexInterestRate: bigint;
    let maxInterestRate: bigint;
    let minInterestRate: bigint;
    let updatedAt: bigint;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any

    before(async () => {
        await deployments.fixture();

        const { getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();
        const { deploy } = deployments;
        market_ = await getProxyContract(hre, CONTRACTS.Market, deployer);
        const config = getConfig(hre.network.name);
        vertexDebtRatio = BigInt(config.marketGeneralConfig.vertexDebtRatio);
        vertexInterestRate = BigInt(config.marketGeneralConfig.vertexInterestRate);
        maxInterestRate = BigInt(config.marketGeneralConfig.maxInterestRate);
        minInterestRate = BigInt(config.marketGeneralConfig.minInterestRate);
        // deploy self-controlled interest rate model contract
        interestRateModel_ = await getProxyContract(hre, CONTRACTS.DebtInterestRateModel, account1);

        await deploy(CONTRACTS.DebtInterestRateModel.name, {
            from: deployer,
            contract: CONTRACTS.DebtInterestRateModel.contract,
            args: [],
            log: true,
        });
        interestRateModel_ = await hre.ethers.getContract(CONTRACTS.DebtInterestRateModel.name);
        await (await interestRateModel_.initialize(await market_.getAddress(), deployer)).wait();
        totalDebt = BigInt(normalized(123456789.1234567));
        debtRatio = BigInt(normalized(0.1)); // 10%
        await (await interestRateModel_.update(totalDebt, debtRatio)).wait();
        await (await interestRateModel_.updateMaxInterestRate()).wait();
        updatedAt = BigInt(await helpers.time.latest());
    });
    it("debt ratio < vertex debt ratio", async () => {
        // check status
        expect(await interestRateModel_.totalDebt()).to.deep.eq(totalDebt);
        expect(await interestRateModel_.debtRatio()).to.deep.eq(debtRatio);
        expect(await interestRateModel_.maxInterestRate()).to.deep.eq(normalized(1.2));
        expect(await interestRateModel_.updatedAt()).to.deep.eq(updatedAt);
        expect(await interestRateModel_.nextInterest()).to.deep.eq(0);
        // check interest in 10 days
        await helpers.time.setNextBlockTimestamp(updatedAt + 10n * DAY);
        await helpers.mine();
        const interestRate =
            minInterestRate + mul_D(div_D(debtRatio, vertexDebtRatio), vertexInterestRate - minInterestRate);
        const deltaT = 10n * DAY;
        const nextInterest = mul_D(totalDebt * deltaT, interestRate) / (365n * DAY);
        expect(await interestRateModel_.nextInterest()).to.deep.eq(nextInterest);
        await (await interestRateModel_.updateMaxInterestRate()).wait();
        updatedAt = BigInt(await helpers.time.latest());
        debtRatio = BigInt(normalized(0.5));
        await (await interestRateModel_.update(totalDebt, debtRatio)).wait();
    });

    it("debt ratio > vertex debt ratio", async () => {
        // check status
        expect(await interestRateModel_.totalDebt()).to.deep.eq(totalDebt);
        expect(await interestRateModel_.debtRatio()).to.deep.eq(debtRatio);
        expect(await interestRateModel_.maxInterestRate()).to.deep.eq(normalized(1.2));
        expect(await interestRateModel_.updatedAt()).to.deep.eq(updatedAt);
        // validate function
        const validate = async (n: bigint) => {
            const deltaT = n * HOUR;
            await helpers.time.setNextBlockTimestamp(updatedAt + deltaT);
            await helpers.mine();
            const IR_M =
                vertexInterestRate +
                ((debtRatio - vertexDebtRatio) * ((maxInterestRate * (24n + n)) / 24n - vertexInterestRate)) /
                    (UNIT - vertexDebtRatio);
            const nextInterest = mul_D(totalDebt * deltaT, IR_M) / (365n * DAY);
            expect(await interestRateModel_.nextInterest()).to.deep.eq(nextInterest);
            await helpers.time.setNextBlockTimestamp(updatedAt + deltaT);
            await (await interestRateModel_.updateMaxInterestRate()).wait();
            maxInterestRate = (maxInterestRate * (12n + n)) / 12n;
            expect(await interestRateModel_.maxInterestRate()).to.deep.eq(maxInterestRate);
            updatedAt = BigInt(await helpers.time.latest());
        };
        for (let i = 1n; i < 36n; ++i) {
            await validate(i);
        }
    });
});
