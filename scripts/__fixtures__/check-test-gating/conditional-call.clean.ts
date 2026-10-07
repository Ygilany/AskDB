describe("always runs", () => {
  it("inside a suite", () => {});
});
for (const c of cases) it(`parametrized ${c}`, () => {});
cases.forEach((c) => test(`each ${c}`, () => {}));
function register() {
  describe("defined in a helper", () => {});
}
if (ready) {
  expect(1).toBe(1);
}
const label = ok ? "describe(" : "it(";
const value = cond ? helpers.describe("member") : other.it("member");
const fixtures = { base: test.extend({}), first: it("in an object literal", () => {}) };
function typed(fn: (name: string) => void = test("default", () => {})) { return fn; }
