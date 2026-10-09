import { integrationSuite } from "./elsewhere";
const run = integrationSuite({});
run("a helper with the same name from another module", () => {
  it("inside an unknown helper's callback", () => {}); // HIT
});
