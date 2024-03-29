import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "hardhat-abi-exporter";
import "hardhat-deploy";
import "hardhat-deploy-ethers";
import "hardhat-gas-reporter";
import "hardhat-interface-generator";
import { HardhatUserConfig, HttpNetworkUserConfig } from "hardhat/types";
import "solidity-coverage";

// environment configs
import dotenv from "dotenv";
dotenv.config();
const { NODE_URL, DEPLOYER_KEY, ETHERSCAN_API_KEY } = process.env;

// 0x0739857bc8892cdeba5f6d51cf095f25549c7554
const DEFAULT_DEPLOYER = "21c1db3dc75c2398838b1588f35403fd025cd15fcd27a785ba2c2aa5ea8e8069";

const userConfig: HttpNetworkUserConfig = {
    accounts: [DEPLOYER_KEY ? DEPLOYER_KEY : DEFAULT_DEPLOYER],
};

// tasks
import "./src/tasks/access";
import "./src/tasks/codesize";
import "./src/tasks/collateral";
import "./src/tasks/coupon";
import "./src/tasks/faucetToken";
import "./src/tasks/oracle";
import "./src/tasks/perp";
import "./src/tasks/settings";
import "./src/tasks/timelock";
import "./src/tasks/upgrade";

const config: HardhatUserConfig = {
    paths: {
        artifacts: "build/artifacts",
        cache: "build/cache",
        sources: "contracts",
        deploy: "src/deploy",
    },
    solidity: {
        compilers: [
            {
                version: "0.8.16",
                settings: {
                    evmVersion: "london",
                    optimizer: {
                        enabled: true,
                        runs: 200,
                    },
                },
            },
        ],
    },
    networks: {
        hardhat: {
            allowUnlimitedContractSize: true,
            allowBlocksWithSameTimestamp: true,
            blockGasLimit: 100000000,
            gas: 100000000,
        },
        ArbGoerliTestnet: {
            ...userConfig,
            //url: "https://endpoints.omniatech.io/v1/arbitrum/goerli/public",
            url: "https://goerli-rollup.arbitrum.io/rpc",
        },
        ScrollSepolia: {
            ...userConfig,
            url: "https://sepolia-rpc.scroll.io",
            gasPrice: 10000000, // 0.01 gwei
        },
        Scroll: {
            ...userConfig,
            url: "https://rpc.scroll.io",
            gasPrice: 400000000, // 0.4 gwei
        },
    },
    namedAccounts: {
        deployer: 0,
    },
    mocha: {
        timeout: 2000000,
    },
    etherscan: {
        apiKey: ETHERSCAN_API_KEY,
    },
    gasReporter: {
        enabled: process.env.REPORT_GAS ? true : false,
    },
    abiExporter: {
        path: "./abis",
        runOnCompile: true,
        clear: true,
        flat: true,
        format: "json",
    },
};
if (NODE_URL && config.networks) {
    config.networks.custom = {
        ...userConfig,
        url: NODE_URL,
    };
}
export default config;
