import { HardhatRuntimeEnvironment } from "hardhat/types";
import "hardhat-deploy";
import { ethers } from "ethers";
import { BigNumber } from "bignumber.js";

// const ERC1967PROXY = "ERC1967Proxy";
const UPGRADEABLE_BEACON = "UpgradeableBeacon";
const BEACON_PROXY = "BeaconProxy";
export const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
export const MINTER_ROLE = ethers.id("MINTER_ROLE");
export const PAUSER_ROLE = ethers.id("PAUSER_ROLE");
export const SPENDER_ROLE = ethers.id("SPENDER_ROLE");
export const VESTING_ROLE = ethers.id("VESTING_ROLE");
export const PERP_DOMAIN = ethers.encodeBytes32String("perpDomain");
export const MARGIN_DOMAIN = ethers.encodeBytes32String("marginDomain");
export const UNIT = "1000000000000000000";
export const MAX_UINT256 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
export const ADDR0 = "0x0000000000000000000000000000000000000000";

export function validateError(e: unknown, msg: string) {
    if (e instanceof Error) {
        if (!e.toString().includes(msg)) {
            throw Error(`unexpected error: ${e}`);
        }
    } else {
        throw Error(`unexpected error: ${e}`);
    }
}

export function mul_D(x: ethers.BigNumber, y: ethers.BigNumber) {
    return x.mul(y).div(UNIT);
}

export function div_D(x: ethers.BigNumber, y: ethers.BigNumber) {
    return x.mul(UNIT).div(y);
}

export function diff_D(x: ethers.BigNumber, y: ethers.BigNumber) {
    return x > y ? x.sub(y) : y.sub(x);
}

export function tokenOf(x: number, decimals: number) {
    return new BigNumber(x).multipliedBy(10 ** decimals).toString(10);
}

export function normalized(x: number) {
    return new BigNumber(x).multipliedBy(UNIT).toString(10);
}

export function usdcOf(x: number) {
    return new BigNumber(x).multipliedBy(1e6).toString(10);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mustGetKey(obj: { [x: string]: any } | undefined, key: string) {
    if (!obj || !(key in obj)) throw new Error(`key ${key} non-exist`);
    return obj[key];
}

export function perpDomainKey(market: string) {
    return ethers.utils.solidityKeccak256(["address", "bytes32"], [market, PERP_DOMAIN]);
}

export function marginDomainKey(token: string) {
    return ethers.utils.solidityKeccak256(["address", "bytes32"], [token, MARGIN_DOMAIN]);
}

export function perpConfigKey(market: string, key: string) {
    return ethers.utils.solidityKeccak256(
        ["bytes32", "bytes32"],
        [perpDomainKey(market), ethers.utils.formatBytes32String(key)]
    );
}

export function marginConfigKey(token: string, key: string) {
    return ethers.utils.solidityKeccak256(
        ["bytes32", "bytes32"],
        [marginDomainKey(token), ethers.utils.formatBytes32String(key)]
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
    VolumeTracker: { name: "VolumeTracker", contract: "VolumeTracker" },
    MarginTracker: { name: "MarginTracker", contract: "MarginTracker" },
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
    Timelock: { name: "Timelock", contract: "TimelockController" },
    NFTDescriptor: { name: "NFTDescriptor", contract: "NFTDescriptor" },
    DebtInterestRateModel: { name: "DebtInterestRateModel", contract: "DebtInterestRateModel" },
    TokenMinter: { name: "TokenMinter", contract: "TokenMinter" },
    CouponStaking: { name: "CouponStaking", contract: "CouponStaking" },
    // for test env
    USDC: { name: "USDC", contract: "FaucetToken" },
    WETH: { name: "WETH", contract: "FaucetWETH" },
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

async function deployInBeaconProxy(hre: HardhatRuntimeEnvironment, contract: ContractMeta, args: unknown[] = []) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    const { deploy } = deployments;
    // deploy implementation
    await deploy(`${contract.name}Impl`, {
        from: deployer,
        contract: contract.contract,
        args: args,
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

export async function transact(contract: ethers.Contract, methodName: string, params: unknown[], execute: boolean) {
    if (execute) {
        await (await contract[methodName](...params)).wait();
    } else {
        console.log(`to: ${contract.address}`);
        console.log(`func: ${contract.interface.getFunction(methodName).format()}`);
        console.log(`params: ${JSON.stringify(params)}`);
        console.log(`data: ${contract.interface.encodeFunctionData(methodName, params)}`);
    }
}

export { deployInBeaconProxy, getProxyContract, CONTRACTS };
