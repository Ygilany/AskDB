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
