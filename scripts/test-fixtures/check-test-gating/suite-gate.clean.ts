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
describe("a negative timeout before a named body", -1, noParameterBody);
describe("a numeric timeout before a named body", 5_000, noParameterBody);
describe("null options before a named body", null, noParameterBody);
describe.each(["url|port\n"], "x", 5432)("template values without a pick $url", () => {});
const names = { a: "postgres" };
describe(names[process.env.ENGINE ?? "a"], () => {
  it("q", () => {});
});
describe("a timeout behind a comma, before a named body", (0, 5_000), noParameterBody);
it("a timeout picked behind a comma", () => {}, process.env.SLOW ? (0, 60_000) : 5_000);
describe.each([["pg"]].slice(void (process.env.DATABASE_URL ? 0 : 1)))("a void over a pick is always undefined %s", () => {});
describe("a todo key under meta", { meta: { todo: "#123" } }, () => {});
describe("a suite timeout read from the environment", process.env.SUITE_TIMEOUT, () => {});
describe.each([process.env.CI ? "a" : "b", "c"].map((e) => e))("map keeps a picked element's table size %s", () => {});
describe.each([process.env.CI ? "a" : "b", "c"].with(0, "d"))("with keeps the size %s", () => {});
describe.each([process.env.CI ? "a" : "b", "c"].toSorted())("toSorted keeps the size %s", () => {});
describe.each([process.env.CI ? "a" : "b", "c"].toReversed())("toReversed keeps the size %s", () => {});
describe.each([...[process.env.CI ? "a" : "b", "c"].keys()])("keys keeps the size %s", () => {});
describe.each([...[process.env.CI ? "a" : "b", "c"].entries()])("entries keeps the size %s", () => {});
describe.each([process.env.CI ? "a" : "b", "c"].values().toArray())("values and toArray keep the size %s", () => {});
new class { constructor() { describe("a suite in a constructor called without parentheses", () => {}); } };
const fixedEngines = ["pg", process.env.CI ? "sqlite" : "mysql"];
describe.each(fixedEngines)("a const table with a picked element but a fixed size %s", () => {});
const cycleA = cycleB, cycleB = cycleA;
describe.each(cycleA)("a cycle of consts ends %s", () => {});
const alwaysPushed = ["sqlite"];
alwaysPushed.push("pg");
describe.each(alwaysPushed)("a table pushed to unconditionally %s", () => {});
describe.each([process.env.PG_URL ?? "pg", "sqlite"].map((e) => e))("env values mapped keep the size %s", () => {});
const pushedInTest: string[] = [];
describe.each(pushedInTest)("a table only pushed to inside a test %s", () => {
  it("pushes", () => { if (process.env.CI) pushedInTest.push("x"); });
});
const pushedInHook: string[] = [];
beforeAll(() => { if (process.env.CI) pushedInHook.push("x"); });
describe.each(pushedInHook)("a table only pushed to in a hook %s", () => {});
import { beforeAll as setupOnce } from "vitest";
const pushedInRenamedHook: string[] = [];
setupOnce(() => { if (process.env.CI) pushedInRenamedHook.push("x"); });
describe.each(pushedInRenamedHook)("a table pushed to in a renamed Vitest hook %s", () => {});
const readOnlyRows = ["pg", "sqlite"];
const hasPg = readOnlyRows.includes("pg");
if (process.env.CI) { console.log(readOnlyRows.length); }
describe.each(readOnlyRows)("a table only read, never resized %s", () => {});
import { IMPORTED_TIMEOUT } from "./timeouts";
describe("a function body ignores what follows it", () => {}, IMPORTED_TIMEOUT);
const fixedUrl = process.env.DATABASE_URL ?? "postgres://localhost";
describe.each([fixedUrl, "sqlite"])("a const env read in a table no step filters %s", () => {});
if (process.env.CI) console.log(-readOnlyRows.length, !readOnlyRows[0]);
import { env as configEnv } from "./config";
describe.each([configEnv.LABEL, "sqlite"].filter(Boolean))("an env object from another module %s", () => {});
