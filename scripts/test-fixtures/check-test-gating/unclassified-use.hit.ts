const alias = describe; // HIT
(process.env.DATABASE_URL && describe)?.("chosen by &&", run); // HIT
const chosen = process.env.DATABASE_URL || it; // HIT
register(describe); // HIT
describe.call(null, "through .call", run); // HIT
it.apply(null, ["through .apply", run]); // HIT
const bound = test.bind(null); // HIT
const o = { describe }; // HIT
const table = it.each([1, 2]); // HIT
const collector = describe("a stored suite", () => {}); // HIT
describe("a suite whose collector is read", () => {}).test.skip("query", run); // HIT
describe("a destructured test API", ({ skipIf }) => {
  skipIf(!process.env.DATABASE_URL)("query", run); // HIT
});
describe("a rest test API", (...api) => {
  api[0].skipIf(!process.env.DATABASE_URL)("query", run); // HIT
});
let registry;
registry = describe("an assigned suite", () => {}); // HIT
const namedBody = (test) => {
  test.skipIf(!process.env.DATABASE_URL)("query", run);
};
describe("a body passed by name", namedBody); // HIT
function declaredBody(test) {
  test.skipIf(!process.env.DATABASE_URL)("query", run);
}
describe("a declared body passed by name", declaredBody); // HIT
describe("a body read off an object", suites.db); // HIT
describe("a bound body", declaredBody.bind(null)); // HIT
describe("a body behind a comma", (0, (test) => test.skipIf(!process.env.DATABASE_URL)("query", run))); // HIT
let assignedBody;
assignedBody = (test) => {
  test.skipIf(!process.env.DATABASE_URL)("query", run);
};
describe("a body assigned after its declaration", assignedBody); // HIT
describe("a named body after options", { timeout: 5 }, declaredBody); // HIT
let assignedInline;
describe("a body assigned inside the call", assignedInline = (test) => test.skipIf(!process.env.DATABASE_URL)("query", run)); // HIT
let reassignedBody = () => {};
if (!process.env.DATABASE_URL) reassignedBody = undefined;
describe("a let body reassigned under a condition", reassignedBody); // HIT
function noParameterDeclaration() {}
describe("a function declaration, which can be reassigned", noParameterDeclaration); // HIT
describe("a function body reading arguments", function () { arguments[0].skipIf(!process.env.DATABASE_URL)("query", run); }); // HIT
const argumentsBody = function () {
  arguments[0].skipIf(!process.env.DATABASE_URL)("query", run);
};
describe("a const body reading arguments", argumentsBody); // HIT
async function awaitedBodies() {
  describe("an awaited body", await function (t) { t.skipIf(!process.env.DATABASE_URL)("query", run); }); // HIT
}
describe("a global body", globalBody); // HIT
describe("a body third after undefined", undefined, declaredBody); // HIT
describe("a body third after a picked timeout", process.env.SLOW ? 60_000 : 5_000, declaredBody); // HIT
describe("an arrow inside a function body reading arguments", function () { it("q", () => arguments[0].skipIf(!process.env.DATABASE_URL)("q", run)); }); // HIT
for (const loopBody of [() => {}]) describe("a for-of const body", loopBody); // HIT
const mixedPick = process.env.DATABASE_URL ? (t) => t.skipIf(!process.env.DATABASE_URL)("q", run) : 5;
describe("a const pick with a function branch before a body", mixedPick, noParameterRun); // HIT
const noParameterRun = () => {};
it("options built by Object.fromEntries over a pick", Object.fromEntries(process.env.DATABASE_URL ? [] : [["skip", true]]), () => {}); // HIT
it("options parsed from a picked string", JSON.parse(process.env.DATABASE_URL ? "{}" : '{"skip":true}'), () => {}); // HIT
it("options built from a skip entry", Object.fromEntries([["skip", !process.env.DATABASE_URL]]), () => {}); // HIT
it("options parsed from a template", JSON.parse(`{"skip": ${!process.env.DATABASE_URL}}`), () => {}); // HIT
it("options from a tagged template", opts`${process.env.DATABASE_URL ? "" : "skip"}`, () => {}); // HIT
it("options from a picked receiver", (process.env.DATABASE_URL ? fastOptions : slowOptions).build(), () => {}); // HIT
it("options from a helper over a fallback", buildOptions(process.env.MODE ?? fallbackMode), () => {}); // HIT
it("options from a look-alike parseInt", Foo.parseInt(process.env.MODE ?? fallbackMode), () => {}); // HIT
it("options merged by a call, which the check can't read", Object.assign({}, { timeout: 5_000 }), () => {}); // HIT
const SKIP = "skip";
it("options built with a key held in a const", Object.fromEntries([[SKIP, !process.env.DATABASE_URL]]), () => {}); // HIT
it("options from a helper over the environment", optionsFor(process.env.DATABASE_URL), () => {}); // HIT
it("options indexed by a literal pick inside a call", Object.assign({}, [{}, { skip: true }][process.env.DATABASE_URL ? 0 : 1]), () => {}); // HIT
const runDb = async () => {};
it("options built by a call beside a named body", Object.fromEntries([["skip", !process.env.DATABASE_URL]]), runDb); // HIT
it("options parsed from a template beside a named body", JSON.parse(`{"skip": ${!process.env.DATABASE_URL}}`), runDb); // HIT
it("options from a helper beside a bound body", optionsFor(process.env.DATABASE_URL), runDb.bind(null)); // HIT
it("two arguments, neither clearly the body", withDb(runDb), optionsFor(process.env.DATABASE_URL)); // HIT
describe("suite options merged by a call", Object.assign({}, { timeout: 1_000 }), () => {}); // HIT
it("options built by a call on a call", getOpts()(process.env.DATABASE_URL), () => {}); // HIT
function shadowedParseFloat() {
  function parseFloat(x) { return x; }
  it("options through a local parseFloat", parseFloat(process.env.DATABASE_URL), () => {}); // HIT
}
it("options before a Math.constructor value", withDb(runDb), Math.constructor(1)); // HIT
it("a timeout converted from a template over a function", withDb(runDb), Number(`${runDb}`)); // HIT
it("a timeout converted from arithmetic over a function", withDb(runDb), Number(runDb + 0)); // HIT
function shadowedUndefined(undefined) {
  it("a timeout converted from a parameter named undefined", withDb(runDb), Number(undefined)); // HIT
}
function shadowedProcess(process) {
  it("a timeout converted from a local process.env read", withDb(runDb), Number(process.env.SLOW_TIMEOUT)); // HIT
}
it("a timeout converted from another object's env", withDb(runDb), Number(other.env.SLOW_TIMEOUT)); // HIT
it("a timeout converted from another global's env", withDb(runDb), Number(proc.env.SLOW_TIMEOUT)); // HIT
it("a timeout converted from a process member that is a function", withDb(runDb), Number(process.hrtime.bigint)); // HIT
describe("a string in the options slot", "not options", () => { it("q", () => {}); }); // HIT
const timeoutCycleA = timeoutCycleB, timeoutCycleB = timeoutCycleA;
it("a timeout converted from a cycle of consts", withDb(runDb), Number(timeoutCycleA)); // HIT
const viHolder = { vi }; // HIT
const vitestHolder = { vitest }; // HIT
