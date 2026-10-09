import { integrationSuite } from "../../../scripts/test-utils/integration.mjs";
describe("runs", () => {});
describe.concurrent("concurrent suite", () => {});
describe.each([1, 2])("table %s", () => {});
describeWhenReady.skip("an unrelated identifier", () => {});
helpers.describe.skip("a member access, not Vitest's describe", () => {});
const run = integrationSuite({ env: ["DATABASE_URL"] });
run("gated the sanctioned way", () => {});
describe("skip: false on a suite", { skip: false }, () => {});
describe.each(Array.from({ length: rows.filter((r) => r.a ?? r.b).length }, () => [1]))("a pick inside a callback in a length %s", () => {});
describe("a suite body's test API, called directly", (test) => {
  test("query", () => {});
});
describe.each([1, 2])("a row, not the test API %s", (test) => {
  expect(test).toBeGreaterThan(0);
});
it("a test context, not the test API", (test) => {
  expect(test).toBeDefined();
});
describe("a second parameter", (test, extra) => {
  expect(extra).toBeUndefined();
});
const noParameterBody = () => {
  it("inside", () => {});
};
describe("a body passed by name that takes no parameter", noParameterBody);
describe.each([1, 2])("a row body passed by name %s", namedRowBody);
function namedRowBody(row) {
  expect(row).toBeGreaterThan(0);
}
describe("a named body with options", { timeout: 5 }, noParameterBody, 1000);
const suiteOptions = { timeout: 5 };
describe("options held in a variable", suiteOptions, () => {});
describe.each`
  a
  ${1}
`("a tagged-template row body $a", namedRowBody);
describe.for([1])("a .for row body %s", namedRowBody);
describe("a timeout computed at run time", () => {}, Number(process.env.SLOW_TIMEOUT ?? 60_000));
const suiteTimeout = 60 * 1000;
describe("a timeout held in a constant", () => {}, suiteTimeout);
describe("a negative timeout", () => {}, -1);
function suiteInsideAFunction() {
  describe("an arrow body, whose arguments are the outer function's", () => {
    expect(arguments.length).toBe(0);
  });
}
describe("a function body whose nested function reads its own arguments", function () {
  function count() {
    return arguments.length;
  }
  it("uses the helper", () => {
    expect(count()).toBe(0);
  });
});
describe("options in a variable before a named body", suiteOptions, noParameterBody);
describe("a picked timeout before an inline body", process.env.SLOW ? 60_000 : 5_000, () => {});
describe("undefined options before an inline body", undefined, () => {});
const pickedTimeout = process.env.SLOW ? 60_000 : 5_000;
describe("a timeout picked into a const, before a named body", pickedTimeout, noParameterBody);
