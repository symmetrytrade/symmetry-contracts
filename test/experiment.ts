import hre, { deployments } from "hardhat";
import { CONTRACTS, getTypedContract } from "../src/utils/utils";
import { BS } from "../typechain-types";

describe("experiments", () => {
    let bs_: BS;

    before(async () => {
        await deployments.fixture("experiments");
    });

    it("test", async () => {
        bs_ = await getTypedContract(hre, CONTRACTS.BS);
        await bs_.run.send(30);
    });
});
