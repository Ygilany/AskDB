if (!process.env.DATABASE_URL) it.skip("needs a database", () => {}); // HIT
url ? it("a", run) : noop; // HIT
process.env.DATABASE_URL ? noop : describe("db", run); // HIT
process.env.DATABASE_URL && describe("db", run); // HIT
if (process.env.DATABASE_URL) {
  describe("db", () => {}); // HIT
} else {
  it("explains the skip", () => {}); // HIT
}
const ready = hasDriver() || test("fallback", run); // HIT
const pick = ready ? noop : (flag ? it("nested", run) : describe("nested", run)); // HIT
if (process.env.DATABASE_URL) {
  const url = process.env.DATABASE_URL;
  describe("not the first statement", run); // HIT
}
switch (engine) {
  case "postgres":
    describe("one engine", run); // HIT
}
const fallback = maybe ?? it("after ??", run); // HIT
ok &&
  test // HIT
    .each`
      a
      ${1}
    `("tagged-template table %s", run);
if (ok) {
  describe("reported once, at the outer suite", () => { // HIT
    it("inside a conditional suite", run);
  });
}
try {
  await import("better-sqlite3");
  describe("sqlite", run); // HIT
} catch {
  it("better-sqlite3 is not installed", () => {}); // HIT
}
if (ok) {
  rows.forEach((r) => it(`row ${r}`, run)); // HIT
}
switch (engine) {
  default:
    describe("default clause", run); // HIT
}
registered ||= describe("||=", run); // HIT
registered &&= it("&&=", run); // HIT
registered ??= test("??=", run); // HIT
if (ok) it.only("only", run); // HIT
if (ok) it.for([1, 2])("for %s", run); // HIT
optionalDriver?.register(describe("inside an optional call", run)); // HIT
for (const url of process.env.DATABASE_URL ? [process.env.DATABASE_URL] : []) it(`loop over a chosen table ${url}`, run); // HIT
(process.env.DATABASE_URL ? [1] : []).forEach((n) => it(`forEach over a chosen table ${n}`, run)); // HIT
if (ok) {
  describe.each([1, 2])("each under an if %s", () => { // HIT
    it("reported once, at describe.each", run);
  });
}
await import("better-sqlite3").then(() => describe("in a .then callback", run)).catch(() => {}); // HIT
setTimeout(() => it("in a timer callback", run), 0); // HIT
if (ok) describe.concurrent("concurrent", run); // HIT
if (ok) describe.sequential("sequential", run); // HIT
if (ok) describe.shuffle("shuffle", run); // HIT
if (ok) it.fails("fails", run); // HIT
if (ok) it.todo("todo"); // HIT
for (const k in process.env.DATABASE_URL ? { a: 1 } : {}) it(`for-in over a chosen object ${k}`, run); // HIT
await import("better-sqlite3").then((() => describe("parenthesized callback", run))); // HIT
setTimeout((function () { it("function expression in parentheses", run); }), 0); // HIT
promise.then((() => describe("cast callback", run)) as any); // HIT
loadDriver({ onReady: () => { describe("callback in an options object", run); } }); // HIT
loadDriver({ onReady() { describe("object-literal method", run); } }); // HIT
promise.then(...[() => describe("spread callback", run)]); // HIT
new Promise((resolve) => describe("in a Promise executor", run)); // HIT
if (process.env.DATABASE_URL) {
  class Pg {
    static {
      describe("in a static block", run); // HIT
    }
    static suite = describe("in a static field", run); // HIT
  }
}
if (ok) register(class { static { describe("in a class expression's static block", run); } }); // HIT
if (process.env.DATABASE_URL) { class Keyed { [describe("in a computed member key", run)]() {} } } // HIT
if (process.env.DATABASE_URL) { class Decorated { @tag(describe("in a member decorator", run)) method() {} } } // HIT
