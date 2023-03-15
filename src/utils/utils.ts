import { HardhatRuntimeEnvironment } from "hardhat/types";
import hardhat from "hardhat";
import "@nomiclabs/hardhat-ethers";
import "hardhat-deploy";

// const ERC1967PROXY = "ERC1967Proxy";
const UPGRADEABLE_BEACON = "UpgradeableBeacon";
const BEACON_PROXY = "BeaconProxy";
const MINTER_ROLE = hardhat.ethers.utils.id("MINTER_ROLE");

interface ContractMeta {
    name: string;
    contract: string;
}

// name: name to deploy in hre
// contract: contract name
const CONTRACTS: { [key: string]: ContractMeta } = {
    PriceOracle: { name: "PriceOracle", contract: "PriceOracle" },
    Market: { name: "Market", contract: "Market" },
    MarketSettings: { name: "MarketSettings", contract: "MarketSettings" },
    LiquidityManager: {
        name: "LiquidityManager",
        contract: "LiquidityManager",
    },
    PositionManager: {
        name: "PositionManager",
        contract: "PositionManager",
    },
    LPToken: { name: "LPToken", contract: "LPToken" },
    PerpTracker: { name: "PerpTracker", contract: "PerpTracker" },
    // for test env
    USDC: { name: "USDC", contract: "FaucetToken" },
    WETH: { name: "WETH", contract: "FaucetToken" },
    WBTC: { name: "WBTC", contract: "FaucetToken" },
    ChainlinkAggregatorSequencer: {
        name: "ChainlinkAggregatorSequencer",
        contract: "ChainlinkMock",
    },
    ChainlinkAggregatorUSDC: {
        name: "ChainlinkAggregatorUSDC",
        contract: "ChainlinkMock",
    },
    ChainlinkAggregatorWETH: {
        name: "ChainlinkAggregatorWETH",
        contract: "ChainlinkMock",
    },
    ChainlinkAggregatorWBTC: {
        name: "ChainlinkAggregatorWBTC",
        contract: "ChainlinkMock",
    },
    Pyth: { name: "Pyth", contract: "PythMock" },
};

async function deployInBeaconProxy(
    hre: HardhatRuntimeEnvironment,
    contract: ContractMeta
) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const { deploy } = deployments;
    // deploy implementation
    await deploy(`${contract.name}Impl`, {
        from: deployer,
        contract: contract.contract,
        args: [],
        log: true,
    });
    const implementation = await hre.ethers.getContract(`${contract.name}Impl`);
    // deploy beacon
    await deploy(`${contract.name}Beacon`, {
        from: deployer,
        contract: UPGRADEABLE_BEACON,
        args: [implementation.address],
        log: true,
    });
    const beacon = await hre.ethers.getContract(`${contract.name}Beacon`);
    // deploy proxy
    await deploy(contract.name, {
        from: deployer,
        contract: BEACON_PROXY,
        args: [beacon.address, []],
        log: true,
    });
}

async function getProxyContract(
    hre: HardhatRuntimeEnvironment,
    contract: ContractMeta
) {
    const address = (await hre.ethers.getContract(contract.name)).address;
    return hre.ethers.getContractAt(contract.contract, address);
}

export { deployInBeaconProxy, getProxyContract, CONTRACTS, MINTER_ROLE };
