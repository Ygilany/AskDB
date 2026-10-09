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
if (ready) test.extend({});
while (pending.length) it(`drains ${pending.pop()}`, () => {});
describe("suite", () => {
  if (verbose) console.log("conditions inside a suite body are fine");
  it("test", () => {});
});
if (ready) {
  function register() {
    describe("in a declared function, reported where it is called", run);
  }
}
try {
  describe("a try without a catch always runs", run);
} finally {
  cleanup();
}
if (ready) {
  class Suites {
    register() {
      describe("in a method, reported where it is called", run);
    }
  }
}
