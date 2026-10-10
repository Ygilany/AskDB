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
describe("a suite with plain options", { timeout: 5_000 }, () => {});
describe("a suite with skip false", { skip: false }, () => {});
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
console.log(Object.keys(shared));
describe.each(engines)("a const table read elsewhere %s", () => {
  it("a test may change it", () => { engines.push("x"); });
});
beforeAll(() => { engines.length = 0; });
describe.each(Array.from(engines))("a table copied by Array.from %s", () => {});
const engineKeys = Object.keys({ pg: 1 });
describe.each(engineKeys)("keys of a literal %s", () => {});
const builtInRows = [Math.max(1, 2), JSON.stringify({ a: 1 }), Number("3"), new Date(0).toISOString()];
describe.each(builtInRows)("a table built with built-ins %s", () => {});
const sourceRows = [["pg", 1], ["sqlite", 2]];
describe.each(sourceRows.map(([name]) => name))("a table mapped from a const %s", () => {});
describe.each(sourceRows.slice(0, 1))("a table sliced from a const %s", () => {});
describe.each(sourceRows.flatMap(([name]) => [name, `${name}-replica`]))("a table flat-mapped from a const %s", () => {});
const corpus = [["a", 1], ["b", 2]] as const;
const shownRows = corpus.map(([name]) => name).filter((name) => name !== "b" && name.length > 0);
describe.each(corpus)("a table another table is built from %s", () => {});
describe.each(shownRows)("a table filtered on its own data in a callback %s", () => {});
describe.each([["pg", corpus.length > 1 ? "many" : "one"]])("a pick inside a row %s", () => {});
const namedBodyRows = ["pg", "sqlite"];
const checkRows = () => { expect(namedBodyRows.length).toBe(2); };
function seedRows() { namedBodyRows.push("mysql"); }
beforeAll(seedRows);
describe.each(namedBodyRows)("a table read by a named test body and hook %s", () => {
  it("reads it", checkRows);
});
const helperRows = ["pg", "sqlite"];
const checkHelperRows = () => { expect(helperRows.length).toBe(2); };
const runHelper = () => { checkHelperRows(); };
beforeAll(() => checkHelperRows());
describe.each(helperRows)("a table read by a helper called from tests and hooks %s", () => {
  it("calls it", () => { checkHelperRows(); });
  it("passes a function that calls it", runHelper);
});
