import * as helpers from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "ethers";
import hre, { deployments } from "hardhat";
import { getConfig } from "../src/config";
import { DAY, HOUR } from "../src/utils/test_utils";
import { CONTRACTS, deployDirectly, div_D, getTypedContract, mul_D, normalized, UNIT } from "../src/utils/utils";
import { DebtInterestRateModel, Market } from "../typechain-types";

describe("Debt", () => {
    let account1: ethers.Signer;
    let market_: Market;
    let interestRateModel_: DebtInterestRateModel;
    let totalDebt: bigint;
    let debtRatio: bigint;
    let vertexDebtRatio: bigint;
    let vertexInterestRate: bigint;
    let maxInterestRate: bigint;
    let minInterestRate: bigint;
    let updatedAt: bigint;

    before(async () => {
        await deployments.fixture();

        const { getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();
        market_ = await getTypedContract(hre, CONTRACTS.Market);
        const config = getConfig(hre.network.name);
        vertexDebtRatio = config.marketGeneralConfig.vertexDebtRatio;
        vertexInterestRate = config.marketGeneralConfig.vertexInterestRate;
        maxInterestRate = config.marketGeneralConfig.maxInterestRate;
        minInterestRate = config.marketGeneralConfig.minInterestRate;
        // deploy self-controlled interest rate model contract
        interestRateModel_ = await getTypedContract(hre, CONTRACTS.DebtInterestRateModel, account1);

        await deployDirectly(hre, CONTRACTS.DebtInterestRateModel);
        interestRateModel_ = await getTypedContract(hre, CONTRACTS.DebtInterestRateModel);
        await interestRateModel_.initialize(market_, deployer);
        totalDebt = normalized("123456789.1234567");
        debtRatio = normalized("0.1"); // 10%
        await interestRateModel_.update(totalDebt, debtRatio);
        await interestRateModel_.updateMaxInterestRate();
        updatedAt = BigInt(await helpers.time.latest());
    });
    it("debt ratio < vertex debt ratio", async () => {
        // check status
        expect(await interestRateModel_.totalDebt()).to.eq(totalDebt);
        expect(await interestRateModel_.debtRatio()).to.eq(debtRatio);
        expect(await interestRateModel_.maxInterestRate()).to.eq(normalized("1.2"));
        expect(await interestRateModel_.updatedAt()).to.eq(updatedAt);
        expect(await interestRateModel_.nextInterest()).to.eq(0);
        // check interest in 10 days
        await helpers.time.setNextBlockTimestamp(updatedAt + 10n * DAY);
        await helpers.mine();
        const interestRate =
            minInterestRate + mul_D(div_D(debtRatio, vertexDebtRatio), vertexInterestRate - minInterestRate);
        const deltaT = 10n * DAY;
        const nextInterest = mul_D(totalDebt * deltaT, interestRate) / (365n * DAY);
        expect(await interestRateModel_.nextInterest()).to.eq(nextInterest);
        await interestRateModel_.updateMaxInterestRate();
        updatedAt = BigInt(await helpers.time.latest());
        debtRatio = normalized("0.5");
        await interestRateModel_.update(totalDebt, debtRatio);
    });

    it("debt ratio > vertex debt ratio", async () => {
        // check status
        expect(await interestRateModel_.totalDebt()).to.eq(totalDebt);
        expect(await interestRateModel_.debtRatio()).to.eq(debtRatio);
        expect(await interestRateModel_.maxInterestRate()).to.eq(normalized("1.2"));
        expect(await interestRateModel_.updatedAt()).to.eq(updatedAt);
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
            expect(await interestRateModel_.nextInterest()).to.eq(nextInterest);
            await helpers.time.setNextBlockTimestamp(updatedAt + deltaT);
            await interestRateModel_.updateMaxInterestRate();
            maxInterestRate = (maxInterestRate * (12n + n)) / 12n;
            expect(await interestRateModel_.maxInterestRate()).to.eq(maxInterestRate);
            updatedAt = BigInt(await helpers.time.latest());
        };
        for (let i = 1n; i < 36n; ++i) {
            await validate(i);
        }
    });
});
