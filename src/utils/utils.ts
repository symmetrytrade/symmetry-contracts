import { HardhatRuntimeEnvironment } from "hardhat/types";
import "hardhat-deploy";
import { ContractFactory, ContractRunner, ethers } from "ethers";
import { BigNumber } from "bignumber.js";
import {
    PriceOracle__factory,
    Market__factory,
    MarketSettings__factory,
    LiquidityManager__factory,
    PositionManager__factory,
    LPToken__factory,
    PerpTracker__factory,
    FeeTracker__factory,
    VolumeTracker__factory,
    MarginTracker__factory,
    VotingEscrow__factory,
    SYM__factory,
    TradingFeeCoupon__factory,
    LiquidityGauge__factory,
    VotingEscrowCallbackRelayer__factory,
    SYMRate__factory,
    TimelockController__factory,
    NFTDescriptor__factory,
    DebtInterestRateModel__factory,
    TokenMinter__factory,
    CouponStaking__factory,
    FaucetToken__factory,
    FaucetWETH__factory,
    ChainlinkMock__factory,
    PythMock__factory,
} from "../../typechain-types";
import { FACTORY_POSTFIX } from "@typechain/ethers-v6/dist/common";

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
export const UNIT = 10n ** 18n;
export const MAX_UINT256 = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
export const ADDR0 = "0x0000000000000000000000000000000000000000";

export function validateError(e: unknown, msg: string) {
    if (e instanceof Error) {
        if (!e.toString().includes(msg)) {
            throw Error(`unexpected error: ${String(e)}`);
        }
    } else {
        throw Error(`unexpected error: ${String(e)}`);
    }
}

export function mul_D(x: ethers.BigNumberish, y: ethers.BigNumberish) {
    return (BigInt(x) * BigInt(y)) / UNIT;
}

export function div_D(x: ethers.BigNumberish, y: ethers.BigNumberish) {
    return (BigInt(x) * UNIT) / BigInt(y);
}

export function diff_D(x: ethers.BigNumberish, y: ethers.BigNumberish) {
    const diff = BigInt(x) - BigInt(y);
    return diff >= 0 ? diff : -diff;
}

export function tokenOf(x: number, decimals: number) {
    return new BigNumber(x).multipliedBy(10 ** decimals).toString(10);
}

export function normalized(x: number) {
    return new BigNumber(x).multipliedBy(Number(UNIT)).toString(10);
}

export function usdcOf(x: number) {
    return new BigNumber(x).multipliedBy(1e6).toString(10);
}

export function mustGetKey<T>(obj: { [x: string]: T } | undefined, key: string) {
    if (!obj || !(key in obj)) throw new Error(`key ${key} non-exist`);
    return obj[key];
}

export function perpDomainKey(market: string) {
    return ethers.solidityPackedKeccak256(["address", "bytes32"], [market, PERP_DOMAIN]);
}

export function marginDomainKey(token: string) {
    return ethers.solidityPackedKeccak256(["address", "bytes32"], [token, MARGIN_DOMAIN]);
}

export function perpConfigKey(market: string, key: string) {
    return ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32"],
        [perpDomainKey(market), ethers.encodeBytes32String(key)]
    );
}

export function marginConfigKey(token: string, key: string) {
    return ethers.solidityPackedKeccak256(
        ["bytes32", "bytes32"],
        [marginDomainKey(token), ethers.encodeBytes32String(key)]
    );
}

// name: name to deploy in hre
// factory: contract factory
const CONTRACTS = {
    PriceOracle: { name: "PriceOracle", factory: PriceOracle__factory },
    Market: { name: "Market", factory: Market__factory },
    MarketSettings: { name: "MarketSettings", factory: MarketSettings__factory },
    LiquidityManager: {
        name: "LiquidityManager",
        factory: LiquidityManager__factory,
    },
    PositionManager: {
        name: "PositionManager",
        factory: PositionManager__factory,
    },
    LPToken: { name: "LPToken", factory: LPToken__factory },
    PerpTracker: { name: "PerpTracker", factory: PerpTracker__factory },
    FeeTracker: { name: "FeeTracker", factory: FeeTracker__factory },
    VolumeTracker: { name: "VolumeTracker", factory: VolumeTracker__factory },
    MarginTracker: { name: "MarginTracker", factory: MarginTracker__factory },
    VotingEscrow: { name: "VotingEscrow", factory: VotingEscrow__factory },
    SYM: { name: "SYM", factory: SYM__factory },
    TradingFeeCoupon: {
        name: "TradingFeeCoupon",
        factory: TradingFeeCoupon__factory,
    },
    LiquidityGauge: { name: "LiquidityGauge", factory: LiquidityGauge__factory },
    VotingEscrowCallbackRelayer: {
        name: "VotingEscrowCallbackRelayer",
        factory: VotingEscrowCallbackRelayer__factory,
    },
    SYMRate: { name: "SYMRate", factory: SYMRate__factory },
    Timelock: { name: "Timelock", factory: TimelockController__factory },
    NFTDescriptor: { name: "NFTDescriptor", factory: NFTDescriptor__factory },
    DebtInterestRateModel: { name: "DebtInterestRateModel", factory: DebtInterestRateModel__factory },
    TokenMinter: { name: "TokenMinter", factory: TokenMinter__factory },
    CouponStaking: { name: "CouponStaking", factory: CouponStaking__factory },
    // for test env
    USDC: { name: "USDC", factory: FaucetToken__factory },
    WETH: { name: "WETH", factory: FaucetWETH__factory },
    WBTC: { name: "WBTC", factory: FaucetToken__factory },
    ChainlinkAggregatorSequencer: {
        name: "ChainlinkAggregatorSequencer",
        factory: ChainlinkMock__factory,
    },
    ChainlinkAggregatorUSDC: {
        name: "ChainlinkAggregatorUSDC",
        factory: ChainlinkMock__factory,
    },
    ChainlinkAggregatorWETH: {
        name: "ChainlinkAggregatorWETH",
        factory: ChainlinkMock__factory,
    },
    ChainlinkAggregatorWBTC: {
        name: "ChainlinkAggregatorWBTC",
        factory: ChainlinkMock__factory,
    },
    Pyth: { name: "Pyth", factory: PythMock__factory },
} as const;

interface TypechainFactory<T> {
    new (...args: ConstructorParameters<typeof ContractFactory>): ContractFactory;
    connect: (address: string, runner?: ContractRunner | null) => T;
}

interface ContractMeta<T> {
    name: string;
    factory: TypechainFactory<T>;
}

type GetContractTypeFromContractMeta<F> = F extends ContractMeta<infer C> ? C : never;

type AnyContractType = GetContractTypeFromContractMeta<(typeof CONTRACTS)[keyof typeof CONTRACTS]>;

type AnyContractMeta = ContractMeta<AnyContractType>;

// Ensure at compile time that all values in `CONTRACTS` conform to the `ContractMeta` interface
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CONTRACTS_TYPE_CHECK: Readonly<Record<string, ContractMeta<unknown>>> = CONTRACTS;

async function deployDirectly(hre: HardhatRuntimeEnvironment, contract: ContractMeta<unknown>, args: unknown[] = []) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    // deploy implementation
    await deployments.deploy(contract.name, {
        from: deployer,
        contract: contract.factory.name.slice(0, -FACTORY_POSTFIX.length),
        args: args,
        log: true,
    });
}

async function deployInBeaconProxy(
    hre: HardhatRuntimeEnvironment,
    contract: ContractMeta<unknown>,
    args: unknown[] = []
) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    // deploy implementation
    await deployments.deploy(`${contract.name}Impl`, {
        from: deployer,
        contract: contract.factory.name.slice(0, -FACTORY_POSTFIX.length),
        args: args,
        log: true,
    });
    const implementation = await hre.ethers.getContract(`${contract.name}Impl`);
    // deploy beacon
    await deployments.deploy(`${contract.name}Beacon`, {
        from: deployer,
        contract: UPGRADEABLE_BEACON,
        args: [await implementation.getAddress()],
        log: true,
    });
    const beacon = await hre.ethers.getContract(`${contract.name}Beacon`);
    // deploy proxy
    await deployments.deploy(contract.name, {
        from: deployer,
        contract: BEACON_PROXY,
        args: [await beacon.getAddress(), []],
        log: true,
    });
}

async function getTypedContract<T>(
    hre: HardhatRuntimeEnvironment,
    contract: ContractMeta<T>,
    signer?: ethers.Signer | string
) {
    const address = await (await hre.ethers.getContract(contract.name)).getAddress();
    if (signer === undefined) {
        signer = (await hre.getNamedAccounts()).deployer;
    }
    if (typeof signer === "string") {
        signer = await hre.ethers.getSigner(signer);
    }
    return contract.factory.connect(address, signer);
}

export async function transact(contract: ethers.BaseContract, methodName: string, params: unknown[], execute: boolean) {
    if (execute) {
        await (await contract.getFunction(methodName).send(...params)).wait();
    } else {
        console.log(`to: ${await contract.getAddress()}`);
        console.log(`func: ${contract.interface.getFunction(methodName)?.format()}`);
        console.log(`params: ${JSON.stringify(params)}`);
        console.log(`data: ${contract.interface.encodeFunctionData(methodName, params)}`);
    }
}

export { AnyContractMeta, deployDirectly, deployInBeaconProxy, getTypedContract, CONTRACTS };
