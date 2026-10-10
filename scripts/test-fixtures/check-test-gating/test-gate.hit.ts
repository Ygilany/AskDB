const run = () => {};
it.skipIf(!process.env.DATABASE_URL)("gated test", () => {}); // HIT
test.runIf(ok)("gated test", () => {}); // HIT
it.concurrent.skipIf(!ok)("concurrent gated test", () => {}); // HIT
test.sequential.runIf(ok)("sequential gated test", () => {}); // HIT
it("options skip", { skip: !process.env.DATABASE_URL }, () => {}); // HIT
test("options todo", { todo: !ok }, () => {}); // HIT
it("shorthand skip", { skip }, () => {}); // HIT
it("options by &&", ok && { skip: true }, () => {}); // HIT
it[mode]("computed modifier", () => {}); // HIT
it("getter", { get skip() { return !url; } }, () => {}); // HIT
it("quoted key", { "skip": !url }, () => {}); // HIT
it("asserted options", ({ skip: !url }) as TestOptions, () => {}); // HIT
it("satisfies options", { todo: !ok } satisfies TestOptions, () => {}); // HIT
it.each([1, 2])("each with options %s", { skip: !ok }, () => {}); // HIT
it("options chosen by a ternary", ok ? { skip: true } : {}, () => {}); // HIT
it("a body picked by &&", process.env.DATABASE_URL && (async () => {})); // HIT
async function awaitedBody() {
  it("an awaited body pick", await (process.env.DATABASE_URL ? async () => {} : undefined)); // HIT
}
describe("a suite body's test API", (test) => {
  test.skipIf(!process.env.DATABASE_URL)("query", () => {}); // HIT
  test.describe("a nested suite", (inner) => {
    inner.runIf(process.env.DATABASE_URL)("nested query", () => {}); // HIT
  });
});
describe.concurrent("a renamed test API under a modifier", function (t) {
  t.runIf(process.env.DATABASE_URL)("query", () => {}); // HIT
});
test.extend({}).describe("an extended test API's suite", (t) => {
  t.skipIf(!process.env.DATABASE_URL)("query", () => {}); // HIT
});
describe("a this annotation before the test API", function (this: unknown, test) {
  test.skipIf(!process.env.DATABASE_URL)("query", () => {}); // HIT
});
describe("a wrapped suite body", ((t) => {
  t.skipIf(!process.env.DATABASE_URL)("query", () => {}); // HIT
}) as any);
it.each(Array.from({ length: process.env.DATABASE_URL ? 1 : 0, other: 1 }))("a length beside another key %s", () => {}); // HIT
it.each([[2], process.env.DATABASE_URL ? [1] : []].flat())("a picked element after a fixed one %s", () => {}); // HIT
it.each((0, process.env.DATABASE_URL ? [1] : []))("a table picked behind a comma %s", () => {}); // HIT
it("a body picked behind a comma", (0, process.env.DATABASE_URL ? () => {} : undefined)); // HIT
let assignedRows;
it.each(assignedRows = process.env.DATABASE_URL ? [1] : [])("a table picked in an assignment %s", () => {}); // HIT
let assignedTestBody;
it("a body picked in an assignment", assignedTestBody = process.env.DATABASE_URL ? () => {} : undefined); // HIT
it.each([process.env.DATABASE_URL ? [1] : []][0])("an index into a picked table %s", () => {}); // HIT
it("options indexed by a pick", [{}, { skip: true }][process.env.DATABASE_URL ? 0 : 1], () => {}); // HIT
it("a test whose result a condition inverts", { fails: !process.env.DATABASE_URL }, () => {}); // HIT
it("a body read out of a picked array", [process.env.DATABASE_URL ? () => {} : undefined][0]); // HIT
it("options read out of a picked array", [process.env.DATABASE_URL ? {} : { skip: true }][0], () => {}); // HIT
it.each([process.env.DATABASE_URL ? [[1]] : [[2], [3]]][0])("a table read out of a picked array %s", () => {}); // HIT
it("a body read off a picked object", { f: process.env.DATABASE_URL ? () => {} : undefined }.f); // HIT
it("a body read with a picked .at", [() => {}].at(process.env.DATABASE_URL ? 0 : 1)); // HIT
import.meta.vitest?.it.skipIf(!process.env.DATABASE_URL)("an optional import.meta.vitest", () => {}); // HIT
it("options behind an instantiation expression", { skip: !process.env.DATABASE_URL }<never>, () => {}); // HIT
it("options read out of an array", [{ skip: !process.env.DATABASE_URL }][0], () => {}); // HIT
it("options merged by Object.assign", Object.assign({}, { skip: !process.env.DATABASE_URL }), () => {}); // HIT
it("options read off an object", { o: { todo: !process.env.DATABASE_URL } }.o, () => {}); // HIT
it("options picked inside Object.assign", Object.assign({}, process.env.DATABASE_URL ? {} : { skip: true }), () => {}); // HIT
it("options picked inside structuredClone", structuredClone(!process.env.DATABASE_URL && { fails: true }), () => {}); // HIT
const castExtended = test.extend({ db: 1 }) as typeof test;
castExtended.skipIf(!process.env.DATABASE_URL)("a skipIf through a cast extend result", () => {}); // HIT
it("options one level below the pick", Object.assign({}, process.env.DATABASE_URL ? Object.assign({}, { skip: true }) : {}), () => {}); // HIT
it("an array read one level below the pick", Object.assign({}, process.env.DATABASE_URL ? [{ skip: true }][0] : {}), () => {}); // HIT
it("options read back out of a meta key", { meta: { todo: !process.env.DATABASE_URL } }.meta, () => {}); // HIT
it("a body chosen by a literal pick inside a call", Reflect.get([() => {}, undefined], process.env.DATABASE_URL ? 0 : 1)); // HIT
it("a body read by a key picked through an object", Reflect.get([async () => {}, undefined], { i: process.env.DATABASE_URL ? 0 : 1 }.i)); // HIT
it("a body read by a key picked through an element read", Reflect.get([async () => {}, undefined], { i: process.env.DATABASE_URL ? 0 : 1 }["i"])); // HIT
it("a body read through Object.values over a picked key", Reflect.get([async () => {}, undefined], Object.values({ i: process.env.DATABASE_URL ? 0 : 1 })[0])); // HIT
it("a body read through a merged object's picked key", Reflect.get([async () => {}, undefined], Object.assign({}, { i: process.env.DATABASE_URL ? 0 : 1 }).i)); // HIT
it("options first, then a body chosen by a pick", { timeout: 1 }, Reflect.get([async () => {}, undefined], process.env.DATABASE_URL ? 0 : 1)); // HIT
it("a body built by a helper over a picked option, which the helper may read any way", withOptions({ timeout: process.env.CI ? 10_000 : 5_000 }, async () => {})); // HIT
it("a body built by Math.constructor over a pick", Math.constructor(process.env.DATABASE_URL ? async () => {} : undefined)); // HIT
it("a body built by Reflect.apply over a picked argument list", Reflect.apply(Array.prototype.at, [async () => {}, undefined], { 0: process.env.DATABASE_URL ? 0 : 1, length: 1 })); // HIT
function shadowedNumbers() {
  const Number = (x) => x;
  it("a body through a local Number", Number(process.env.DATABASE_URL ? async () => {} : undefined)); // HIT
  const Math = { max: (x) => x };
  it("a body through a local Math.max", Math.max(process.env.DATABASE_URL ? async () => {} : undefined)); // HIT
}
function reassignedNumber() {
  globalThis.Number = (x) => x;
  it("a body through a reassigned Number", Number(process.env.DATABASE_URL ? async () => {} : undefined)); // HIT
  it("a timeout slot through a reassigned Number", {}, Number(process.env.DATABASE_URL ? async () => {} : undefined)); // HIT
}
it("a timeout slot holding an inline function through Number", {}, Number(process.env.DATABASE_URL ? async () => {} : null)); // HIT
it("a number as the body", Number(process.env.DATABASE_URL ? 1 : 2)); // HIT
function declaredTimeoutBody() {}
it("a timeout slot holding a declared function through Number", {}, Number(process.env.DATABASE_URL ? declaredTimeoutBody : 0)); // HIT
let letBody = async () => {};
it("a timeout slot holding a let through Number", {}, Number(process.env.DATABASE_URL ? letBody : 0)); // HIT
it("options built by Object.fromEntries over a pick", Object.fromEntries(process.env.DATABASE_URL ? [] : [["skip", true]]), () => {}); // HIT
it("options parsed from a picked string", JSON.parse(process.env.DATABASE_URL ? "{}" : '{"skip":true}'), () => {}); // HIT
it("options built from a skip entry", Object.fromEntries([["skip", !process.env.DATABASE_URL]]), () => {}); // HIT
it("options parsed from a template", JSON.parse(`{"skip": ${!process.env.DATABASE_URL}}`), () => {}); // HIT
it("options from a tagged template", opts`${process.env.DATABASE_URL ? "" : "skip"}`, () => {}); // HIT
it("options from a picked receiver", (process.env.DATABASE_URL ? fastOptions : slowOptions).build(), () => {}); // HIT
it("options from a helper over a fallback", buildOptions(process.env.MODE ?? fallbackMode), () => {}); // HIT
it("options from a look-alike parseInt", Foo.parseInt(process.env.MODE ?? fallbackMode), () => {}); // HIT
it("options built with a key held in a const", Object.fromEntries([[SKIP, !process.env.DATABASE_URL]]), () => {}); // HIT
it("options from a helper over the environment", optionsFor(process.env.DATABASE_URL), () => {}); // HIT
it("options indexed by a literal pick inside a call", Object.assign({}, [{}, { skip: true }][process.env.DATABASE_URL ? 0 : 1]), () => {}); // HIT
it("options built by a call beside a named body", Object.fromEntries([["skip", !process.env.DATABASE_URL]]), runDb); // HIT
it("options parsed from a template beside a named body", JSON.parse(`{"skip": ${!process.env.DATABASE_URL}}`), runDb); // HIT
it("options from a helper beside a bound body", optionsFor(process.env.DATABASE_URL), runDb.bind(null)); // HIT
it("options built by a call on a call", getOpts()(process.env.DATABASE_URL), () => {}); // HIT
const dbTest = test.extend({ ...baseFixtures, todo: async ({}, use) => use([]) });
it("skip: false", { skip: false }, () => {});
test.scoped({ skip: maybe });
it("a computed literal key", { ["skip"]: true }, run);
it(hasEnv.NAME ?? "a name picked at run time", () => {});
it("an options object nested in a body's closure", () => {
  const options = { skip: !process.env.DATABASE_URL };
  expect(options).toBeDefined();
});
it("a fails key under meta", { meta: { fails: process.env.CI === "true" } }, () => {}); // HIT
