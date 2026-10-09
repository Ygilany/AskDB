import { integrationSuite } from "../../../scripts/test-utils/integration.mjs";
const run = integrationSuite({ env: ["DATABASE_URL"] });
run("gated the sanctioned way", () => {
  it("inside", () => {});
});
integrationSuite({ env: ["MYSQL_DATABASE_URL"] })("inline", () => {
  it("inside inline", () => {});
});
