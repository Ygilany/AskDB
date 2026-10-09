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
