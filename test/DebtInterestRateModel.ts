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
    let totalDebt: ethers.BigNumber;
    let debtRatio: ethers.BigNumber;
    let vertexDebtRatio: ethers.BigNumber;
    let vertexInterestRate: ethers.BigNumber;
    let maxInterestRate: ethers.BigNumber;
    let minInterestRate: ethers.BigNumber;
    let updatedAt: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any

    before(async () => {
        await deployments.fixture();

        const { getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();
        const { deploy } = deployments;
        market_ = await getProxyContract(hre, CONTRACTS.Market, deployer);
        const config = getConfig(hre.network.name);
        vertexDebtRatio = ethers.BigNumber.from(config.marketGeneralConfig.vertexDebtRatio);
        vertexInterestRate = ethers.BigNumber.from(config.marketGeneralConfig.vertexInterestRate);
        maxInterestRate = ethers.BigNumber.from(config.marketGeneralConfig.maxInterestRate);
        minInterestRate = ethers.BigNumber.from(config.marketGeneralConfig.minInterestRate);
        // deploy self-controlled interest rate model contract
        interestRateModel_ = await getProxyContract(hre, CONTRACTS.DebtInterestRateModel, account1);

        await deploy(CONTRACTS.DebtInterestRateModel.name, {
            from: deployer,
            contract: CONTRACTS.DebtInterestRateModel.contract,
            args: [],
            log: true,
        });
        interestRateModel_ = await hre.ethers.getContract(CONTRACTS.DebtInterestRateModel.name);
        await (await interestRateModel_.initialize(market_.address, deployer)).wait();
        totalDebt = ethers.BigNumber.from(normalized(123456789.1234567));
        debtRatio = ethers.BigNumber.from(normalized(0.1)); // 10%
        await (await interestRateModel_.update(totalDebt, debtRatio)).wait();
        await (await interestRateModel_.updateMaxInterestRate()).wait();
        updatedAt = await helpers.time.latest();
    });
    it("debt ratio < vertex debt ratio", async () => {
        // check status
        expect(await interestRateModel_.totalDebt()).to.deep.eq(totalDebt);
        expect(await interestRateModel_.debtRatio()).to.deep.eq(debtRatio);
        expect(await interestRateModel_.maxInterestRate()).to.deep.eq(normalized(1.2));
        expect(await interestRateModel_.updatedAt()).to.deep.eq(updatedAt);
        expect(await interestRateModel_.nextInterest()).to.deep.eq(0);
        // check interest in 10 days
        await helpers.time.setNextBlockTimestamp(updatedAt + 10 * DAY);
        await helpers.mine();
        const interestRate = minInterestRate.add(
            mul_D(div_D(debtRatio, vertexDebtRatio), vertexInterestRate.sub(minInterestRate))
        );
        const deltaT = 10 * DAY;
        const nextInterest = mul_D(totalDebt.mul(deltaT), interestRate).div(365 * DAY);
        expect(await interestRateModel_.nextInterest()).to.deep.eq(nextInterest);
        await (await interestRateModel_.updateMaxInterestRate()).wait();
        updatedAt = await helpers.time.latest();
        debtRatio = ethers.BigNumber.from(normalized(0.5));
        await (await interestRateModel_.update(totalDebt, debtRatio)).wait();
    });

    it("debt ratio > vertex debt ratio", async () => {
        // check status
        expect(await interestRateModel_.totalDebt()).to.deep.eq(totalDebt);
        expect(await interestRateModel_.debtRatio()).to.deep.eq(debtRatio);
        expect(await interestRateModel_.maxInterestRate()).to.deep.eq(normalized(1.2));
        expect(await interestRateModel_.updatedAt()).to.deep.eq(updatedAt);
        // validate function
        const validate = async (n: number) => {
            const deltaT = n * HOUR;
            await helpers.time.setNextBlockTimestamp(updatedAt + deltaT);
            await helpers.mine();
            const IR_M = vertexInterestRate.add(
                debtRatio
                    .sub(vertexDebtRatio)
                    .mul(
                        maxInterestRate
                            .mul(24 + n)
                            .div(24)
                            .sub(vertexInterestRate)
                    )
                    .div(ethers.BigNumber.from(UNIT).sub(vertexDebtRatio))
            );
            const nextInterest = mul_D(totalDebt.mul(deltaT), IR_M).div(365 * DAY);
            expect(await interestRateModel_.nextInterest()).to.deep.eq(nextInterest);
            await helpers.time.setNextBlockTimestamp(updatedAt + deltaT);
            await (await interestRateModel_.updateMaxInterestRate()).wait();
            maxInterestRate = maxInterestRate.mul(12 + n).div(12);
            expect(await interestRateModel_.maxInterestRate()).to.deep.eq(maxInterestRate);
            updatedAt = await helpers.time.latest();
        };
        for (let i = 1; i < 36; ++i) {
            await validate(i);
        }
    });
});
