import "hardhat-deploy";
import "@nomiclabs/hardhat-ethers";
import { task, types } from "hardhat/config";
import { CONTRACTS } from "../utils/utils";

task("timelock:deploy", "deploy timelock contract")
    .addParam("admin", "address of admin", undefined, types.string, false)
    .addParam("delay", "delay period", undefined, types.int, false)
    .setAction(async (taskArgs, hre) => {
        const { deployments, getNamedAccounts } = hre;
        const { deployer } = await getNamedAccounts();
        const { deploy } = deployments;

        await deploy(CONTRACTS.Timelock.name, {
            from: deployer,
            contract: CONTRACTS.Timelock.contract,
            args: [taskArgs.admin, taskArgs.delay],
            log: true,
        });
    });

task("timelock:queue", "queue timelock transaction")
    .addParam("contractname", "contract name", undefined, types.string, false)
    .addParam("target", "target address", undefined, types.string, false)
    .addParam("eta", "eta", undefined, types.int, false)
    .addParam("value", "transaction value", "0", types.string, true)
    .addParam("methodname", "method name", undefined, types.string, false)
    .addVariadicPositionalParam("arguments")
    .setAction(async (taskArgs, hre) => {
        const contractInterface = (
            await hre.ethers.getContractFactory(taskArgs.contractname)
        ).interface;
        const signature = contractInterface
            .getFunction(taskArgs.methodname)
            .format();
        const data =
            "0x" +
            contractInterface
                .encodeFunctionData(taskArgs.methodname, taskArgs.arguments)
                .substring(10);
        const timelock = (await hre.ethers.getContractFactory("Timelock"))
            .interface;
        /*console.log(`Timelock address:`);
        console.log((await hre.ethers.getContract("Timelock")).address);*/
        console.log(`Timelock queueTransaction payload:`);
        console.log(
            timelock.encodeFunctionData("queueTransaction", [
                taskArgs.target,
                taskArgs.value,
                signature,
                data,
                taskArgs.eta,
            ])
        );
    });

task("timelock:execute", "queue timelock transaction")
    .addParam("contractname", "contract name", undefined, types.string, false)
    .addParam("target", "target address", undefined, types.string, false)
    .addParam("eta", "eta", undefined, types.int, false)
    .addParam("value", "transaction value", "0", types.string, true)
    .addParam("methodname", "method name", undefined, types.string, false)
    .addVariadicPositionalParam("arguments")
    .setAction(async (taskArgs, hre) => {
        const contractInterface = (
            await hre.ethers.getContractFactory(taskArgs.contractname)
        ).interface;
        const signature = contractInterface
            .getFunction(taskArgs.methodname)
            .format();
        const data =
            "0x" +
            contractInterface
                .encodeFunctionData(taskArgs.methodname, taskArgs.arguments)
                .substring(10);
        const timelock = (await hre.ethers.getContractFactory("Timelock"))
            .interface;
        /*console.log(`Timelock address:`);
        console.log((await hre.ethers.getContract("Timelock")).address);*/
        console.log(`Timelock executeTransaction payload:`);
        console.log(
            timelock.encodeFunctionData("executeTransaction", [
                taskArgs.target,
                taskArgs.value,
                signature,
                data,
                taskArgs.eta,
            ])
        );
    });
