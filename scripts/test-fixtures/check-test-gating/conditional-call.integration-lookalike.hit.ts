import { integrationSuite } from "./test-utils/integration";
import { integrationSuite as lookalike } from "../lookalike-scripts/test-utils/integration.mjs";
import { integrationSuite as sameSuffix } from "../scripts/test-utils/integration.mjs";
import { isIntegrationRequired } from "../../../scripts/test-utils/integration.mjs";
integrationSuite({})("a package-local helper module", () => {
  it("inside an unknown helper's callback", () => {}); // HIT
});
lookalike({})("a lookalike module path", () => {
  it("inside a lookalike helper's callback", () => {}); // HIT
});
isIntegrationRequired({})("another export of the real module", () => {
  it("inside a non-factory export's callback", () => {}); // HIT
});
import * as lookalikeNs from "../lookalike/test-utils/integration.mjs";
lookalikeNs.integrationSuite({})("a namespace from a lookalike path", () => {
  it("inside a lookalike namespace's callback", () => {}); // HIT
});
const local = makeLocal();
local.integrationSuite({})("a local object's method", () => {
  it("inside a local object's callback", () => {}); // HIT
});
sameSuffix({})("a copy at the same scripts/test-utils/integration.mjs suffix", () => {
  it("inside a same-suffix copy's callback", () => {}); // HIT
});
