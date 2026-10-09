import { integrationSuite } from "../../../scripts/test-utils/integration.mjs";
const run = integrationSuite({ env: ["DATABASE_URL"] });
run("gated the sanctioned way", () => {
  it("inside", () => {});
});
integrationSuite({ env: ["MYSQL_DATABASE_URL"] })("inline", () => {
  it("inside inline", () => {});
});
import { integrationSuite as gate } from "../../../scripts/test-utils/integration.mjs";
gate({ env: ["X"] })("renamed sanctioned gate", () => {
  it("inside", () => {});
});
import * as integration from "../../../scripts/test-utils/integration.mjs";
integration.integrationSuite({ env: ["Y"] })("through a namespace import", () => {
  it("inside", () => {});
});
it("reads the flag through the namespace", () => {
  integration.isIntegrationRequired();
});
const castSuite = integrationSuite({ env: ["URL"] }) as typeof describe;
castSuite("a sanctioned suite behind a cast", () => {});
const bangSuite = integrationSuite({ env: ["URL"] })!;
bangSuite("a sanctioned suite behind !", () => {});
