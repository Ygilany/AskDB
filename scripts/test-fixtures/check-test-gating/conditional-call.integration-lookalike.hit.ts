import { integrationSuite } from "./test-utils/integration";
import { integrationSuite as lookalike } from "../lookalike-scripts/test-utils/integration.mjs";
import { isIntegrationRequired } from "../../scripts/test-utils/integration.mjs";
integrationSuite({})("a package-local helper with the same path suffix", () => {
  it("inside an unknown helper's callback", () => {}); // HIT
});
lookalike({})("a lookalike module path", () => {
  it("inside a lookalike helper's callback", () => {}); // HIT
});
isIntegrationRequired({})("another export of the real module", () => {
  it("inside a non-factory export's callback", () => {}); // HIT
});
