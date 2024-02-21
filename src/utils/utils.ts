import { FACTORY_POSTFIX } from "@typechain/ethers-v6/dist/common";
import {
    AddressLike,
    BaseContract,
    BigNumberish,
    ContractFactory,
    ContractRunner,
    encodeBytes32String,
    ethers,
    parseUnits,
    resolveAddress,
    Signer,
    solidityPackedKeccak256,
} from "ethers";
import { HardhatRuntimeEnvironment } from "hardhat/types";

// We use the Typechain factory class objects to fill the `CONTRACTS` mapping. These objects are used
// by hardhat-deploy to locate compiled contract artifacts. However, an exception occurs if we import
// from Typechain files before they are generated. To avoid this, we follow a two-step process:
//
// 1. We import the types at compile time to ensure type safety. Hardhat does not report an error even
// if these files are not yet generated, as long as the "--typecheck" command-line argument is not used.
import * as TypechainTypes from "../../typechain-types";
// 2. We import the values at runtime and silently ignore any exceptions.
let Factories = {} as typeof TypechainTypes;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Factories = require("../../typechain-types") as typeof TypechainTypes;
} catch (err) {
    // ignore
}

// const ERC1967PROXY = "ERC1967Proxy";
const UPGRADEABLE_BEACON = "UpgradeableBeacon";
const BEACON_PROXY = "BeaconProxy";
export const DEFAULT_ADMIN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000";
export const MINTER_ROLE = ethers.id("MINTER_ROLE");
export const PAUSER_ROLE = ethers.id("PAUSER_ROLE");
export const SPENDER_ROLE = ethers.id("SPENDER_ROLE");
export const VESTING_ROLE = ethers.id("VESTING_ROLE");
export const PERP_DOMAIN = encodeBytes32String("perpDomain");
export const MARGIN_DOMAIN = encodeBytes32String("marginDomain");
export const UNIT = 10n ** 18n;

export function validateError(e: unknown, msg: string) {
    if (e instanceof Error) {
        if (!e.toString().includes(msg)) {
            throw Error(`unexpected error: ${String(e)}`);
        }
    } else {
        throw Error(`unexpected error: ${String(e)}`);
    }
}

export function mul_D(x: BigNumberish, y: BigNumberish) {
    return (BigInt(x) * BigInt(y)) / UNIT;
}

export function div_D(x: BigNumberish, y: BigNumberish) {
    return (BigInt(x) * UNIT) / BigInt(y);
}

export function diff_D(x: BigNumberish, y: BigNumberish) {
    const diff = BigInt(x) - BigInt(y);
    return diff >= 0 ? diff : -diff;
}

export function tokenOf(x: string | number, decimals: number) {
    if (typeof x === "string") {
        return parseUnits(x, decimals);
    } else if (Number.isSafeInteger(x)) {
        return BigInt(x) * 10n ** BigInt(decimals);
    } else {
        throw Error(`unsafe convertion from number ${x} to bigint`);
    }
}

export function normalized(x: string | number) {
    return tokenOf(x, 18);
}

export function usdcOf(x: string | number) {
    return tokenOf(x, 6);
}

export function mustGetKey<T>(obj: { [x: string]: T } | undefined, key: string) {
    if (!obj || !(key in obj)) throw new Error(`key ${key} non-exist`);
    return obj[key];
}

export async function perpDomainKey(market: AddressLike) {
    return solidityPackedKeccak256(["address", "bytes32"], [await resolveAddress(market), PERP_DOMAIN]);
}

export async function marginDomainKey(token: AddressLike) {
    return solidityPackedKeccak256(["address", "bytes32"], [await resolveAddress(token), MARGIN_DOMAIN]);
}

export async function perpConfigKey(market: AddressLike, key: string) {
    return solidityPackedKeccak256(["bytes32", "bytes32"], [await perpDomainKey(market), encodeBytes32String(key)]);
}

export async function marginConfigKey(token: AddressLike, key: string) {
    return solidityPackedKeccak256(["bytes32", "bytes32"], [await marginDomainKey(token), encodeBytes32String(key)]);
}

interface TypechainFactory<T> {
    new (...args: ConstructorParameters<typeof ContractFactory>): ContractFactory;
    connect: (address: string, runner?: ContractRunner | null) => T;
}

class ContractMeta<T> {
    factory: TypechainFactory<T>;
    /** Deployment name */
    name: string;

    constructor(factory: TypechainFactory<T>, name?: string) {
        this.factory = factory;
        this.name = name ?? this.contractName();
    }

    contractName() {
        // this.factory is undefined when the typechain files are not generated yet
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        return this.factory?.name.slice(0, -FACTORY_POSTFIX.length);
    }
}

export const CONTRACTS = {
    PriceOracle: new ContractMeta(Factories.PriceOracle__factory),
    Market: new ContractMeta(Factories.Market__factory),
    MarketSettings: new ContractMeta(Factories.MarketSettings__factory),
    LiquidityManager: new ContractMeta(Factories.LiquidityManager__factory),
    PositionManager: new ContractMeta(Factories.PositionManager__factory),
    LPToken: new ContractMeta(Factories.LPToken__factory),
    PerpTracker: new ContractMeta(Factories.PerpTracker__factory),
    FeeTracker: new ContractMeta(Factories.FeeTracker__factory),
    VolumeTracker: new ContractMeta(Factories.VolumeTracker__factory),
    MarginTracker: new ContractMeta(Factories.MarginTracker__factory),
    VotingEscrow: new ContractMeta(Factories.VotingEscrow__factory),
    SYM: new ContractMeta(Factories.SYM__factory),
    TradingFeeCoupon: new ContractMeta(Factories.TradingFeeCoupon__factory),
    LiquidityGauge: new ContractMeta(Factories.LiquidityGauge__factory),
    VotingEscrowCallbackRelayer: new ContractMeta(Factories.VotingEscrowCallbackRelayer__factory),
    SYMRate: new ContractMeta(Factories.SYMRate__factory),
    Timelock: new ContractMeta(Factories.TimelockController__factory, "Timelock"),
    NFTDescriptor: new ContractMeta(Factories.NFTDescriptor__factory),
    DebtInterestRateModel: new ContractMeta(Factories.DebtInterestRateModel__factory),
    TokenMinter: new ContractMeta(Factories.TokenMinter__factory),
    CouponStaking: new ContractMeta(Factories.CouponStaking__factory),
    // for test env
    USDC: new ContractMeta(Factories.FaucetToken__factory, "USDC"),
    WETH: new ContractMeta(Factories.FaucetWETH__factory, "WETH"),
    WBTC: new ContractMeta(Factories.FaucetToken__factory, "WBTC"),
    ChainlinkAggregatorSequencer: new ContractMeta(Factories.ChainlinkMock__factory, "ChainlinkAggregatorSequencer"),
    ChainlinkAggregatorUSDC: new ContractMeta(Factories.ChainlinkMock__factory, "ChainlinkAggregatorUSDC"),
    ChainlinkAggregatorWETH: new ContractMeta(Factories.ChainlinkMock__factory, "ChainlinkAggregatorWETH"),
    ChainlinkAggregatorWBTC: new ContractMeta(Factories.ChainlinkMock__factory, "ChainlinkAggregatorWBTC"),
    Pyth: new ContractMeta(Factories.PythMock__factory, "Pyth"),
} as const;

type GetContractTypeFromContractMeta<F> = F extends ContractMeta<infer C> ? C : never;

type AnyContractType = GetContractTypeFromContractMeta<(typeof CONTRACTS)[keyof typeof CONTRACTS]>;

export type AnyContractMeta = ContractMeta<AnyContractType>;

// Ensure at compile time that all values in `CONTRACTS` conform to the `ContractMeta` interface
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const CONTRACTS_TYPE_CHECK: Readonly<Record<string, ContractMeta<BaseContract>>> = CONTRACTS;

export async function deployDirectly(
    hre: HardhatRuntimeEnvironment,
    contract: ContractMeta<unknown>,
    args: unknown[] = []
) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    // deploy implementation
    await deployments.deploy(contract.name, {
        from: deployer,
        contract: contract.contractName(),
        args: args,
        log: true,
    });
}

export async function deployInBeaconProxy(
    hre: HardhatRuntimeEnvironment,
    contract: ContractMeta<unknown>,
    args: unknown[] = []
) {
    const { deployments, getNamedAccounts } = hre;
    const { deployer } = await getNamedAccounts();
    // deploy implementation
    await deployments.deploy(`${contract.name}Impl`, {
        from: deployer,
        contract: contract.contractName(),
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

export async function getTypedContract<T>(
    hre: HardhatRuntimeEnvironment,
    contract: ContractMeta<T>,
    signer?: Signer | string
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

export async function transact(contract: BaseContract, methodName: string, params: unknown[], execute: boolean) {
    if (execute) {
        await (await contract.getFunction(methodName).send(...params)).wait();
    } else {
        console.log(`to: ${await contract.getAddress()}`);
        console.log(`func: ${contract.interface.getFunction(methodName)?.format()}`);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        console.log(`params: ${JSON.stringify(params, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`);
        console.log(`data: ${contract.interface.encodeFunctionData(methodName, params)}`);
    }
}
