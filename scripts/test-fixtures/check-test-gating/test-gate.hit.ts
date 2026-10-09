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
it.each((url && [url]) || [])("rows chosen by && and || %s", () => {}); // HIT
it("options chosen by a ternary", ok ? { skip: true } : {}, () => {}); // HIT
it("a body picked by &&", process.env.DATABASE_URL && (async () => {})); // HIT
it("a timeout or a body", () => {}, ok ? 5 : fn); // HIT
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
