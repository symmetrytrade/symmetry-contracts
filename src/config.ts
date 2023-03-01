interface NetworkConfigs {
    addresses?: { [key: string]: string };
}

const GlobalConfig: { [key: string]: NetworkConfigs } = {
    arbitrum: {
        addresses: {
            USDC: "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8",
        },
    },
    hardhat: {},
};

export { GlobalConfig };
