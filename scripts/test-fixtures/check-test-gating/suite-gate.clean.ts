{
  const plainProcessAlias = { env: {} };
  describe.each([plainProcessAlias.env.LABEL, "sqlite"].filter(Boolean))("an object named like process holds no env %s", () => {});
}
const pushedInOtherHooks: string[] = [];
beforeEach(() => { if (process.env.CI) pushedInOtherHooks.push("x"); });
afterAll(() => { if (process.env.CI) pushedInOtherHooks.push("x"); });
afterEach(() => { if (process.env.CI) pushedInOtherHooks.push("x"); });
onTestFinished(() => { if (process.env.CI) pushedInOtherHooks.push("x"); });
onTestFailed(() => { if (process.env.CI) pushedInOtherHooks.push("x"); });
describe.each(pushedInOtherHooks)("a table pushed to in every other hook %s", () => {});
// Plain suites and tables: literal or `const` tables, tables built from data with no environment
// read, and table inputs used elsewhere only by reads, tests and hooks.
import { IMPORTED_ROWS } from "./rows";
const noParameter = () => {};
describe("a suite with plain options", { timeout: 5_000 }, noParameter);
describe("a suite with skip false", { skip: false }, noParameter);
describe.each([["pg"], ["sqlite"]])("a literal table %s", () => {});
const engines = ["pg", "sqlite"];
describe.each(engines)("a const table %s", () => {});
describe.each`
  engine
  ${"pg"}
`("a template table $engine", () => {});
describe.each(IMPORTED_ROWS)("an imported table %s", () => {});
describe.each([...IMPORTED_ROWS])("a spread of an imported table %s", () => {});
describe.each(IMPORTED_ROWS.filter((row) => row !== "x" && row.length > 0))("a data filter with && %s", () => {});
const corpus = [{ input: "a", label: "A" }, { input: "b", label: "B" }];
const shown = corpus.map(({ input }) => input).filter((input) => input !== "b" || corpus.length > 1);
describe.each(shown)("a table derived from a const by reads %s", () => {});
const fixturePath = new URL("./fixtures/", import.meta.url);
describe.each([fixturePath.href])("a table built from the file's own URL %s", () => {});
const shared = { rag: null };
describe.each([["omitted", shared]])("a shared value as a row entry %s", () => {});
const withShared = { ...shared, extra: 1 };
console.log(engines.length, engines.includes("pg"), Object.keys(shared));
describe.each(engines)("a const table read elsewhere %s", () => {
  it("a test may change it", () => { engines.push("x"); });
});
beforeAll(() => { engines.length = 0; });
describe.each(Array.from(engines))("a table copied by Array.from %s", () => {});
const engineKeys = Object.keys({ pg: 1 });
describe.each(engineKeys)("keys of a literal %s", () => {});
