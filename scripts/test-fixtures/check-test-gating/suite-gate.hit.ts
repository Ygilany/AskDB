// Every line marked HIT must be reported under this file's rule; no other line may be.
describe.skip("plain skipped suite", () => {}); // HIT
describe.skipIf(!process.env.DATABASE_URL)("gated suite", () => {}); // HIT
describe.runIf(process.env.DATABASE_URL)("gated suite", () => {}); // HIT
describe.concurrent.skip("concurrent skipped suite", () => {}); // HIT
suite.skip("suite alias", () => {}); // HIT
suite.skipIf(!ok)("suite alias, gated", () => {}); // HIT
describe // HIT
  .skip("split across lines", () => {});
const note = "// check-test-gating-ignore-next-line: inside a string, so not a pragma";
describe.skip("a pragma inside a string exempts nothing", () => {}); // HIT
// check-test-gating-ignore-next-line:
describe.skip("a pragma with no reason exempts nothing", () => {}); // HIT
describe["skip"]("element access", () => {}); // HIT
/* check-test-gating-ignore-next-line: a block comment is not a pragma */
describe.skip("a pragma in a block comment exempts nothing", () => {}); // HIT
// check-test-gating-ignore-next-line: exempts only the line right below
const unrelated = 1;
describe.skip("two lines below a pragma", () => {}); // HIT
describe!.skip("non-null assertion", () => {}); // HIT
(describe as any).skipIf(!url)("type assertion", () => {}); // HIT
(describe satisfies unknown as typeof describe).skip("satisfies", () => {}); // HIT
(<any>describe).skip("angle-bracket assertion", () => {}); // HIT
describe("options skip", { skip: !process.env.DATABASE_URL }, () => {}); // HIT
describe("options skip: true", { skip: true }, () => {}); // HIT
describe("options picked by a ternary", process.env.DATABASE_URL ? {} : { skip: true }, () => {}); // HIT
describe[process.env.DATABASE_URL ? "concurrent" : "skip"]("computed modifier", () => {}); // HIT
describe("computed literal key", { ["skip"]: true }, () => {}); // HIT
describe.each([1, 2])("describe.each with options %s", { skip: !ok }, () => {}); // HIT
// see check-test-gating-ignore-next-line: for details
describe.skip("a marker mid-comment exempts nothing", () => {}); // HIT
describe.each(process.env.DATABASE_URL ? [process.env.DATABASE_URL] : [])("rows chosen by a ternary %s", () => {}); // HIT
describe.each([["sqlite"], ...(process.env.DATABASE_URL ? [["postgres"]] : [])])("a row spread from a ternary %s", () => {}); // HIT
it.describe.skip("it.describe is Vitest's describe", () => {}); // HIT
describe("a timeout before the skip key", { timeout: 5000, skip: !process.env.DATABASE_URL }, () => {}); // HIT
describe("a body picked by a ternary", process.env.DATABASE_URL ? () => {} : undefined); // HIT
describe("todo: true on a suite", { todo: true }, () => {}); // HIT
describe.todo("describe.todo never runs its tests", () => {}); // HIT
describe.each(Object.entries(process.env.DATABASE_URL ? { postgres: 1 } : {}))("a table built from a pick %s", () => {}); // HIT
describe.each((process.env.DATABASE_URL ? [1] : []).map((u) => [u]))("rows from a picked receiver %s", () => {}); // HIT
describe.each([...new Map(process.env.DATABASE_URL ? [[1, 2]] : [])])("rows from new Map %s", () => {}); // HIT
/** @example // check-test-gating-ignore-next-line: a marker after a JSDoc tag is not a line comment
 */ describe.skip("a marker in JSDoc exempts nothing", () => {}); // HIT
describe.each(Array.from({ length: process.env.DATABASE_URL ? 1 : 0 }, () => [1]))("a length picked inside a call %s", () => {}); // HIT
async function awaitedOptions() {
  describe("awaited options pick", await (process.env.DATABASE_URL ? {} : { skip: true }), () => {}); // HIT
}
describe.each(Array.from({ length: Number(process.env.DATABASE_URL ? 1 : 0) }, () => [1]))("a length computed from a pick %s", () => {}); // HIT
describe.each(Array.from(...(process.env.DATABASE_URL ? [[1]] : [[]])))("rows spread from a pick %s", () => {}); // HIT
describe.each(["url|port\n"], ...(process.env.DATABASE_URL ? [process.env.DATABASE_URL, 5432] : [5432]))("template values spread from a pick $url", () => {}); // HIT
describe.each([process.env.DATABASE_URL ? "url|port\n" : "port\n"], "x", 5432)("a template header picked $port", () => {}); // HIT
describe.for(["url\n"], process.env.DATABASE_URL ? "a" : undefined)("a picked template value %s", () => {}); // HIT
let pickedLater;
describe("a picked body assigned inside the call", pickedLater = process.env.DATABASE_URL ? () => {} : undefined); // HIT
describe.each((0, process.env.DATABASE_URL ? [1] : []))("a table picked behind a comma %s", () => {}); // HIT
describe("a suite whose results a condition inverts", { fails: !process.env.DATABASE_URL }, () => {}); // HIT
describe("a suite expected to fail", { fails: true }, () => {}); // HIT
describe.each([["pg"]].slice((process.env.DATABASE_URL ? 0 : 1) + 0))("a slice bound computed from a pick %s", () => {}); // HIT
describe.each(`${process.env.DATABASE_URL ?? ""}`.split(""))("a template over a pick %s", () => {}); // HIT
describe.each([["pg"]].slice(-(process.env.DATABASE_URL ? 0 : 1)))("a negated pick %s", () => {}); // HIT
describe.each([["pg"]].slice("" + (process.env.DATABASE_URL ? 0 : 1)))("a concatenated pick %s", () => {}); // HIT
describe.each([["pg"]].slice(+(typeof (process.env.DATABASE_URL ?? 0) === "number")))("a typeof over a pick %s", () => {}); // HIT
describe.each(String.raw`${process.env.DATABASE_URL ?? ""}`.split(""))("a tagged template over a pick %s", () => {}); // HIT
describe.each([["pg"]].slice(...[process.env.DATABASE_URL ? 0 : 1]))("a pick spread as an argument %s", () => {}); // HIT
describe.each([["pg"]].slice(`${1}${process.env.DATABASE_URL ? 0 : 1}`))("a second template span picked %s", () => {}); // HIT
describe.each((process.env.DATABASE_URL ? [[1]] : [])<never>)("a picked table behind an instantiation expression %s", () => {}); // HIT
describe("a body computed by a call", withDb(process.env.DATABASE_URL ?? ":memory:", () => {})); // HIT
describe.each([["pg"], ["my"]].slice(...[0, process.env.DATABASE_URL ? 1 : 2]))("a mixed spread with a picked element %s", () => {}); // HIT
describe.each([process.env.PG_URL ? "pg" : null, "sqlite"].filter(Boolean))("a table filtered over a picked element %s", () => {}); // HIT
describe.each([process.env.PG_URL ? "pg" : null, "sqlite"].map((x) => x).filter(Boolean))("a map then filter over a picked element %s", () => {}); // HIT
describe.each(Array.from([process.env.PG_URL ? "pg" : null, "sqlite"]).filter(Boolean))("Array.from then filter %s", () => {}); // HIT
describe.each([...new Set(["sqlite", process.env.ENGINE ?? "sqlite"])])("a Set merging a picked engine %s", () => {}); // HIT
describe.each(Object.keys({ [process.env.PG_URL ? "pg" : "sqlite"]: 1, sqlite: 1 }))("a picked computed key %s", () => {}); // HIT
describe.each(Object.values({ pg: process.env.PG_URL ? "pg" : null, sqlite: "sqlite" }).filter(Boolean))("Object.values then filter %s", () => {}); // HIT
describe.each(Object.keys(Object.fromEntries([[process.env.PG_URL ? "pg" : "sqlite", 1], ["sqlite", 1]])))("Object.fromEntries merging a picked key %s", () => {}); // HIT
describe.each(onlyAvailable([process.env.PG_URL ? "pg" : null, "sqlite"]))("a helper over a table holding a pick %s", () => {}); // HIT
describe.each(onlyAvailable([process.env.PG_URL ? "pg" : null, "sqlite"]).map((e) => e))("a size-keeping step over a helper's result %s", () => {}); // HIT
describe.each(values([process.env.PG_URL ? "pg" : null, "sqlite"]))("a bare helper named like a size-keeping method %s", () => {}); // HIT
describe.each([...new Set([...["sqlite", process.env.ENGINE ?? "sqlite"]])])("a pick spread into the table a Set dedupes %s", () => {}); // HIT
describe.each(merge([], [process.env.PG_URL ? "pg" : null, "sqlite"]))("a table holding a pick in a later argument %s", () => {}); // HIT
describe.each([process.env.PG_URL ? "pg" : null, "sqlite"].flatMap((x) => x ? [x] : []))("flatMap over a table holding a pick %s", () => {}); // HIT
describe.each([process.env.PG_URL ? "pg" : null, "sqlite"].reduce((a, x) => x ? [...a, x] : a, []))("reduce over a table holding a pick %s", () => {}); // HIT
describe.each(engines.values([process.env.PG_URL ? "pg" : null, "sqlite"]))("a helper named values taking the table %s", () => {}); // HIT
describe.each(_.map([process.env.PG_URL ? "pg" : null, "sqlite"], (e) => e).filter(Boolean))("a helper named map taking the table %s", () => {}); // HIT
{
  const Array = { from: (t) => t.filter(Boolean) };
  describe.each(Array.from([process.env.DATABASE_URL ? "pg" : null]))("a local Array.from %s", () => {}); // HIT
}
{
  const Object = { values: (t) => Object.values(t).filter(Boolean) };
  describe.each(Object.values({ pg: process.env.DATABASE_URL ? "pg" : null }))("a local Object.values %s", () => {}); // HIT
}
const pickedUrls = process.env.DATABASE_URL ? [process.env.DATABASE_URL] : [];
describe.each(pickedUrls)("a picked table held in a const %s", () => {}); // HIT
describe.each([process.env.PG_URL, process.env.MYSQL_URL].filter(Boolean))("env values filtered %s", () => {}); // HIT
describe.each(Object.values({ pg: process.env.PG_URL }).filter(Boolean))("env values in an object filtered %s", () => {}); // HIT
const constPgUrl = process.env.DATABASE_URL;
const constMysqlUrl = process.env.MYSQL_DATABASE_URL;
describe.each([constPgUrl, constMysqlUrl].filter(Boolean))("const-held env reads filtered %s", () => {}); // HIT
const constPickRows = [process.env.PG_URL ? "pg" : null, "sqlite"];
describe.each(constPickRows.filter(Boolean))("a const table holding a pick, filtered %s", () => {}); // HIT
describe.each([...new Set(constPickRows)])("a const table holding a pick, deduped %s", () => {}); // HIT
const { PG_URL: destructuredPgUrl } = process.env;
describe.each([destructuredPgUrl, "sqlite"].filter(Boolean))("an env name destructured from process.env %s", () => {}); // HIT
import { env as processEnv } from "node:process";
describe.each([processEnv.PG_URL, "sqlite"].filter(Boolean))("env from node:process filtered %s", () => {}); // HIT
import { env as bareProcessEnv } from "process";
describe.each([bareProcessEnv.PG_URL, "sqlite"].filter(Boolean))("env from process filtered %s", () => {}); // HIT
import processDefault from "node:process";
describe.each([processDefault.env.PG_URL, "sqlite"].filter(Boolean))("env through a default process import %s", () => {}); // HIT
const aliasedEnv = process.env;
describe.each([aliasedEnv.PG_URL, "sqlite"].filter(Boolean))("env through a const alias %s", () => {}); // HIT
import * as processNs from "node:process";
describe.each([processNs.env.PG_URL, "sqlite"].filter(Boolean))("env through a namespace process import %s", () => {}); // HIT
{
  const { PG_URL: defaultedPgUrl = "" } = process.env;
  describe.each([defaultedPgUrl, "sqlite"].filter(Boolean))("an env name destructured with a default, filtered %s", () => {}); // HIT
}
{
  const TypedEngines = process.env.PG_URL ? ["pg", "sqlite"] : ["sqlite"];
  type TypedEngines = string[];
  describe.each(TypedEngines)("a picked const beside a type of the same name %s", () => {}); // HIT
}
{
  const pickedProperty = { engines: process.env.PG_URL ? ["pg", "sqlite"] : ["sqlite"] };
  describe.each(pickedProperty.engines)("a picked property of a const object %s", () => {}); // HIT
}
{
  const { engines: fromPickedHolder } = process.env.PG_URL ? { engines: ["pg"] } : { engines: [] };
  describe.each(fromPickedHolder)("a table destructured from a picked holder %s", () => {}); // HIT
}
{
  const { engines: fromLiteralPick } = { engines: process.env.PG_URL ? ["pg"] : [] };
  describe.each(fromLiteralPick)("a table destructured from a literal holding a pick %s", () => {}); // HIT
}
{
  const { env: destructuredEnv } = process;
  describe.each([destructuredEnv.PG_URL, "sqlite"].filter(Boolean))("env destructured from process %s", () => {}); // HIT
  describe.each([process["env"].PG_URL, "sqlite"].filter(Boolean))("process element-read env %s", () => {}); // HIT
  describe.each([globalThis.process.env.PG_URL, "sqlite"].filter(Boolean))("globalThis.process env %s", () => {}); // HIT
  describe.each([import.meta.env.PG_URL, "sqlite"].filter(Boolean))("import.meta.env %s", () => {}); // HIT
}
{
  const cfgHolder = { engines: process.env.PG_URL ? ["pg"] : [] };
  const { engines: viaConstHolder } = cfgHolder;
  describe.each(viaConstHolder)("a table destructured from a const holding a pick %s", () => {}); // HIT
}
{
  describe.each([{ name: "pg", url: process.env.PG_URL }, { name: "sqlite", url: ":memory:" }].filter((e) => e.url))("env read inside an object row %s", () => {}); // HIT
  const objectRows = [{ name: "pg", url: process.env.PG_URL }, { name: "sqlite", url: ":memory:" }];
  describe.each(objectRows.filter((e) => e.url))("env read inside a const table's object row %s", () => {}); // HIT
  describe.each([["pg", process.env.PG_URL], ["sqlite", ":memory:"]].filter(([, u]) => u))("env read inside a tuple row %s", () => {}); // HIT
  describe.each(Object.entries({ pg: { url: process.env.PG_URL }, sqlite: { url: ":memory:" } }).filter(([, c]) => c.url))("env read inside an object value %s", () => {}); // HIT
  describe.each([process.env.PG_URL?.trim(), "sqlite"].filter(Boolean))("env read under a method call %s", () => {}); // HIT
}
{
  const processAlias = process;
  describe.each([processAlias.env.PG_URL, "sqlite"].filter(Boolean))("env through a const alias of process %s", () => {}); // HIT
  const { PG_URL: viaAliasEnv } = processAlias.env;
  describe.each([viaAliasEnv, "sqlite"].filter(Boolean))("env destructured through a process alias %s", () => {}); // HIT
}
{
  const suitesWithPick = [{ name: "pg", engines: process.env.PG_URL ? ["pg"] : [] }, { name: "sqlite", engines: ["sqlite"] }];
  describe.each(suitesWithPick)("a table whose rows read the environment $name", () => {}); // HIT
}
describe("a body third after a picked timeout", process.env.SLOW ? 60_000 : 5_000, declaredBody); // HIT
if (ready) test.beforeEach(() => {});
describe.each(Object.entries({ postgres: process.env.PG_URL ?? "postgres://localhost" }))("a value picked inside a fixed table %s", () => {}); // HIT
describe("a picked timeout before an inline body", process.env.SLOW ? 60_000 : 5_000, () => {}); // HIT
describe.each([["pg"]].slice(void (process.env.DATABASE_URL ? 0 : 1)))("a void over a pick is always undefined %s", () => {}); // HIT
describe("a todo key under meta", { meta: { todo: "#123" } }, () => {});
describe("a suite timeout read from the environment", process.env.SUITE_TIMEOUT, () => {}); // HIT
describe.each([process.env.CI ? "a" : "b", "c"].map((e) => e))("map keeps a picked element's table size %s", () => {}); // HIT
describe.each([process.env.CI ? "a" : "b", "c"].with(0, "d"))("with keeps the size %s", () => {}); // HIT
describe.each([process.env.CI ? "a" : "b", "c"].toSorted())("toSorted keeps the size %s", () => {}); // HIT
describe.each([process.env.CI ? "a" : "b", "c"].toReversed())("toReversed keeps the size %s", () => {}); // HIT
describe.each([...[process.env.CI ? "a" : "b", "c"].keys()])("keys keeps the size %s", () => {}); // HIT
describe.each([...[process.env.CI ? "a" : "b", "c"].entries()])("entries keeps the size %s", () => {}); // HIT
describe.each([process.env.CI ? "a" : "b", "c"].values().toArray())("values and toArray keep the size %s", () => {}); // HIT
const fixedEngines = ["pg", process.env.CI ? "sqlite" : "mysql"];
describe.each(fixedEngines)("a const table with a picked element but a fixed size %s", () => {}); // HIT
describe.each([process.env.PG_URL ?? "pg", "sqlite"].map((e) => e))("env values mapped keep the size %s", () => {}); // HIT
const fixedUrl = process.env.DATABASE_URL ?? "postgres://localhost";
describe.each([fixedUrl, "sqlite"])("a const env read in a table no step filters %s", () => {}); // HIT
{
  const { LABELS: { PG_URL: nestedLabel } } = process.env;
  describe.each([nestedLabel, "sqlite"].filter(Boolean))("a name nested under an env key is not an env read %s", () => {}); // HIT
  const [fromArrayPattern] = process.env;
  describe.each([fromArrayPattern, "sqlite"].filter(Boolean))("an array pattern reads no env key %s", () => {}); // HIT
}
describe.each([{ name: "pg", url: process.env.PG_URL }, { name: "sqlite", url: ":memory:" }])("a table whose rows read the environment, no step filtering %s", () => {}); // HIT
import { existsSync } from "node:fs";
import { platform } from "node:os";
describe.each(existsSync(new URL("./x.db", import.meta.url)) ? ["db"] : [])("a table picked by a file probe %s", () => {}); // HIT
describe.each(platform() === "win32" ? [] : ["posix"])("a table picked by the platform %s", () => {}); // HIT
const { driver: probedDriver } = await loadProbe();
describe.each(probedDriver ? [["sqlite", probedDriver]] : [])("a table picked on a probe result %s", () => {}); // HIT
async function loadProbe() { return { driver: undefined as unknown }; }
function engineList() { if (existsSync("x.db")) return ["db"]; return []; }
describe.each(engineList())("a table a helper builds under an if %s", () => {}); // HIT
