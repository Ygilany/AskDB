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
describe("computed key", { [key]: false }, () => {}); // HIT
describe("spread options", { ...opts }, () => {}); // HIT
describe.each([1, 2])("describe.each with options %s", { skip: !ok }, () => {}); // HIT
// see check-test-gating-ignore-next-line: for details
describe.skip("a marker mid-comment exempts nothing", () => {}); // HIT
describe.each(process.env.DATABASE_URL ? [process.env.DATABASE_URL] : [])("rows chosen by a ternary %s", () => {}); // HIT
describe(...["spread arguments", { skip: !process.env.DATABASE_URL }, () => {}]); // HIT
describe.each(...rowsAndMore)("spread rows %s", () => {}); // HIT
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
