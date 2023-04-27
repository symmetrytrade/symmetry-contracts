import { HardhatRuntimeEnvironment } from "hardhat/types";
import hardhat from "hardhat";
import "@nomiclabs/hardhat-ethers";
import "hardhat-deploy";
import { ethers } from "ethers";
import { BigNumber } from "bignumber.js";

// const ERC1967PROXY = "ERC1967Proxy";
const UPGRADEABLE_BEACON = "UpgradeableBeacon";
const BEACON_PROXY = "BeaconProxy";
export const MINTER_ROLE = hardhat.ethers.utils.id("MINTER_ROLE");
export const SPENDER_ROLE = hardhat.ethers.utils.id("SPENDER_ROLE");
export const PERP_DOMAIN =
    hardhat.ethers.utils.formatBytes32String("perpDomain");
export const UNIT = "1000000000000000000";
export const MAX_UINT256 =
    "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
export const ADDR0 = "0x0000000000000000000000000000000000000000";

export function normalized(x: number) {
    return new BigNumber(x).multipliedBy(UNIT).toString(10);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mustGetKey(obj: { [x: string]: any } | undefined, key: string) {
    if (!obj || !(key in obj)) throw new Error(`key ${key} non-exist`);
    return obj[key];
}

export function perpMarketKey(market: string) {
    return hardhat.ethers.utils.solidityKeccak256(
        ["address", "bytes32"],
        [market, PERP_DOMAIN]
    );
}

export function perpConfigKey(market: string, key: string) {
    return hardhat.ethers.utils.solidityKeccak256(
        ["bytes32", "bytes32"],
        [perpMarketKey(market), hardhat.ethers.utils.formatBytes32String(key)]
    );
}

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
    FeeTracker: { name: "FeeTracker", contract: "FeeTracker" },
    VotingEscrow: { name: "VotingEscrow", contract: "VotingEscrow" },
    SYM: { name: "SYM", contract: "SYM" },
    TradingFeeCoupon: {
        name: "TradingFeeCoupon",
        contract: "TradingFeeCoupon",
    },
    LiquidityGauge: { name: "LiquidityGauge", contract: "LiquidityGauge" },
    VotingEscrowCallbackRelayer: {
        name: "VotingEscrowCallbackRelayer",
        contract: "VotingEscrowCallbackRelayer",
    },
    SYMRate: { name: "SYMRate", contract: "SYMRate" },
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
    contract: ContractMeta,
    signer: ethers.Signer | string
) {
    const address = (await hre.ethers.getContract(contract.name)).address;
    return hre.ethers.getContractAt(contract.contract, address, signer);
}

export { deployInBeaconProxy, getProxyContract, CONTRACTS };
