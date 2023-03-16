import { deployments } from "hardhat";

describe("setup", () => {
    it("setup deployments", async () => {
        await deployments.fixture();
    });
});
