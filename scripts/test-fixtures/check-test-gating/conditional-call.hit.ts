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
maybe?.[it("inside an optional element access key", run)]; // HIT
function typed(fn: (name: string) => void = test("a default parameter value", () => {})) { return fn; } // HIT
const [first = describe("a destructuring default", run)] = process.env.DATABASE_URL ? [] : [1]; // HIT
maybe`${() => describe("in a tagged template's substitution", run)}`; // HIT
[assignedFirst = describe("an assignment-pattern default", run)] = process.env.DATABASE_URL ? [] : [1]; // HIT
({ shorthandDefault = describe("a shorthand default", run) } = process.env.DATABASE_URL ? {} : { shorthandDefault: 1 }); // HIT
({ key: renamedDefault = describe("a property default", run) } = {}); // HIT
for ([looped = describe("a for-of pattern default", run)] of rows) {} // HIT
await (async () => { await import("pg"); describe("in an async IIFE whose rejection is swallowed", run); })().catch(() => {}); // HIT
for (const engine of ["sqlite", ...(process.env.DATABASE_URL ? ["postgres"] : [])]) it(`loop over a spread pick ${engine}`, run); // HIT
if (process.env.DATABASE_URL) test.extend({ db: describe("under test.extend under an if", run) }); // HIT
(async () => { describe("in an IIFE whose rejection is caught", run); })().catch(() => {}); // HIT
(async () => { describe("in an IIFE with a two-argument then", run); })().then(ok, bad); // HIT
if (ready) it.describe("it.describe under an if", run); // HIT
if (ready) test.suite("test.suite under an if", run); // HIT
for ([forInDefault = describe("a for-in pattern default", run)] in obj) {} // HIT
[...[nestedDefault = describe("a default inside a spread pattern", run)]] = rows; // HIT
Object.entries(process.env.DATABASE_URL ? { postgres: 1 } : {}).forEach(([engine]) => describe(engine, run)); // HIT
for (const [engine] of Object.entries(process.env.DATABASE_URL ? { postgres: 1 } : {})) describe(engine, run); // HIT
for (const [engine] of Object.entries({ sqlite: 1, ...(process.env.DATABASE_URL ? { postgres: 2 } : {}) })) describe(engine, run); // HIT
(process.env.DATABASE_URL ? [1] : []).map((n) => n).forEach((n) => describe(`receiver pick ${n}`, run)); // HIT
for (const u of new Set(process.env.DATABASE_URL ? [1] : [])) describe(`new Set over a pick ${u}`, run); // HIT
for (const u of await Promise.resolve(process.env.DATABASE_URL ? [1] : [])) describe(`awaited pick ${u}`, run); // HIT
for (const u of [process.env.DATABASE_URL ? [1] : []].flat()) describe(`a pick inside a flattened receiver ${u}`, run); // HIT
for (const k in { sqlite: 1, ...(process.env.DATABASE_URL ? { postgres: 2 } : {}) }) describe(`for-in over an object spread pick ${k}`, run); // HIT
describe("a suite body's test API under an if", (t) => {
  if (process.env.DATABASE_URL) t("query", run); // HIT
});
for (const u of [process.env.DATABASE_URL ? [] : "x"].flat()) it(`a mixed pick inside a flattened receiver ${u}`, run); // HIT
for (let i = 0; i < (process.env.DATABASE_URL ? 1 : 0); i++) describe(`a for bound picked by a condition ${i}`, run); // HIT
while (process.env.DATABASE_URL ?? false) {
  describe("a while condition holding a pick", run); // HIT
  break;
}
for (const u of (0, process.env.DATABASE_URL ? [1] : [])) describe(`a loop table picked behind a comma ${u}`, run); // HIT
let repeats = 0;
do {
  describe(`a do-while condition holding a pick ${repeats}`, run); // HIT
} while (++repeats < (process.env.DATABASE_URL ? 2 : 1));
let stepped = 0;
for (; stepped < (process.env.DATABASE_URL ? 1 : 0); describe("a for incrementor under a picked condition", run)) stepped++; // HIT
for (const u of [1].slice((process.env.DATABASE_URL ? 0 : 1) * 1)) describe(`a loop table sliced by arithmetic over a pick ${u}`, run); // HIT
if (process.env.DATABASE_URL) new (class { constructor() { describe("a class expression's constructor under an if", run); } })(); // HIT
if (process.env.DATABASE_URL) new (class { suite = describe("a class expression's field under an if", run); })(); // HIT
process.env.DATABASE_URL && new (class { m = (() => describe("a class expression's field IIFE under &&", run))(); })(); // HIT
Promise.resolve().then(() => new (class { constructor() { describe("a class expression in a .then callback", run); } })()); // HIT
for (const u of String.raw`${process.env.DATABASE_URL ?? ""}`.split("")) describe(`a loop over a tagged template ${u}`, run); // HIT
new Foo(class { field = describe("a class expression's instance field passed to a call", run); }); // HIT
[["pg"]].values().map(([e]) => describe(`a lazy iterator map taken by a pick ${e}`, run)).take(process.env.DATABASE_URL ? 1 : 0).toArray(); // HIT
[["pg"]].values().map(([e]) => describe(`a lazy map drained by a picked method ${e}`, run))[process.env.DATABASE_URL ? "toArray" : "return"](); // HIT
[process.env.PG_URL ? "pg" : null, "sqlite"].filter(Boolean).forEach((e) => describe(`forEach over a filtered pick ${e}`, run)); // HIT
for (const e of [process.env.PG_URL ? "pg" : null, "sqlite"].filter(Boolean)) describe(`for-of over a filtered pick ${e}`, run); // HIT
for (let i = process.env.DATABASE_URL ? 0 : 1; i < 1; i++) describe("a for initializer holding a pick", run); // HIT
for (let i = 0, n = process.env.DATABASE_URL ? 1 : 0; i < n; i++) describe("a for initializer bound by a pick", run); // HIT
for (const e of new Set(["sqlite", process.env.ENGINE ?? "sqlite"])) describe(`for-of over a Set with a picked engine ${e}`, run); // HIT
new Set(["sqlite", process.env.ENGINE ?? "sqlite"]).forEach((e) => describe(`forEach over a Set with a picked engine ${e}`, run)); // HIT
[process.env.PG_URL ? "pg" : null, "sqlite"].values().toArray().filter(Boolean).forEach((e) => describe(`iterator copy then filter ${e}`, run)); // HIT
_.forEach(process.env.PG_URL ? ["pg"] : [], (e) => { describe(e, () => {}); }); // HIT
const loopUrls = process.env.DATABASE_URL ? [process.env.DATABASE_URL] : [];
for (const url of loopUrls) describe(url, () => {}); // HIT
loopUrls.forEach((url) => { describe(url, () => {}); }); // HIT
const pushedEngines = ["sqlite"];
if (process.env.PG_URL) pushedEngines.push("pg");
for (const e of pushedEngines) describe(e, () => {}); // HIT
const engineSet = new Set(["sqlite"]);
if (process.env.PG_URL) engineSet.add("pg");
engineSet.forEach((e) => { describe(e, () => {}); }); // HIT
const loopPgUrl = process.env.DATABASE_URL;
for (const url of [loopPgUrl, "sqlite"].filter(Boolean)) describe(url, () => {}); // HIT
var varUrls = process.env.DATABASE_URL ? [process.env.DATABASE_URL] : [];
for (const u of varUrls) describe(u, () => {}); // HIT
const forInTables = { sqlite: 1 };
if (process.env.PG_URL) forInTables.pg = 2;
for (const k in forInTables) describe(k, () => {}); // HIT
{
  const { PG_URL: loopDefaulted = "" } = process.env;
  for (const e of [loopDefaulted, "sqlite"].filter(Boolean)) describe(e, () => {}); // HIT
}
