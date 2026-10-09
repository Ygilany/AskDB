import { integrationSuite } from "../../../scripts/test-utils/integration.mjs";
describe("runs", () => {});
describe.concurrent("concurrent suite", () => {});
describe.each([1, 2])("table %s", () => {});
describeWhenReady.skip("an unrelated identifier", () => {});
helpers.describe.skip("a member access, not Vitest's describe", () => {});
const run = integrationSuite({ env: ["DATABASE_URL"] });
run("gated the sanctioned way", () => {});
describe("skip: false on a suite", { skip: false }, () => {});
