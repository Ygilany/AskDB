import { describe, it, test } from "vitest";
type Suite = typeof describe;
const shape = { describe: 1, it: 2 };
shape.describe;
class Page {
  it() {}
  test = 1;
}
const dbTest = test.extend({ db: async ({}, use) => use(1) });
describe("called directly", () => {
  it("works", () => {});
});
type Case = { test: string; it: number };
interface Row { describe: boolean }
enum Kind { test, suite }
const named = function test() {};
const { test: picked } = fixtures;
function run(it: number) { return it; }
let describe2: describe;
export { describe };
label: for (;;) { break label; }
const ids = rows.map((it) => it.id);
try { load(); } catch (test) { report(test); }
it: for (;;) {
  break it;
}
let qualified: Foo.it;
const selfRef = selfRef.extend({});
selfRef("a cycle resolves to nothing", run);
interface Gate { name: string }
const Gate = integrationSuite({ env: ["DATABASE_URL"] });
Gate("an interface merged with a sanctioned gate", () => {});
vi.fn();
vi["useFakeTimers"]();
function takesLocalVi(vi) { register(vi); }
