// The environment read where code runs while Vitest collects suites: anything here could change
// which suites or rows exist, so it fails. A test body, a hook, a plain `const` and
// integrationSuite()'s options may read it (collection-env.clean.ts).
import { afterEach as localAfterEach } from "./hooks";
const base = ["pg", "mysql"];
function engines() { return base; }
if (!process.env.DATABASE_URL) base.length = 0; // HIT
describe.each(engines())("a table a helper returns, resized under an if %s", () => {});
const forEachRows = ["pg", "mysql"];
forEachRows.forEach((_e, _i, all) => { if (!process.env.DATABASE_URL) all.length = 0; }); // HIT
describe.each(forEachRows)("a table resized by a forEach callback %s", () => {});
const groups = [["pg", "mysql"]];
if (!process.env.DATABASE_URL) groups.at(0)!.length = 0; // HIT
describe.each(groups.flat())("a row group resized through at() %s", () => {});
const pushed: string[] = [];
if (process.env.PG_URL) pushed.push("pg"); // HIT
const filtered = [process.env.PG_URL ? "pg" : null, "sqlite"].filter(Boolean); // HIT
const dynamicProcess = (await import("node:process")).env.DATABASE_URL; // HIT
const loadedProcess = await vi.importActual("node:process"); // HIT
const trimmed = process.env.PG_URL?.trim(); // HIT
let letRead = process.env.PG_URL; // HIT
describe("a suite body", () => {
  if (process.env.PG_URL) pushed.push("pg"); // HIT
});
setup.beforeAll(() => { if (process.env.PG_URL) pushed.push("pg"); }); // HIT
localAfterEach(() => { if (process.env.PG_URL) pushed.push("pg"); }); // HIT
const url = process.env.DATABASE_URL;
if (url) pushed.push("pg"); // HIT
function connect() { return process.env.DATABASE_URL; }
connect(); // HIT
describe(`named from ${process.env.ENGINE}`, () => {}); // HIT
const { PG_URL: destructuredUrl } = process.env;
if (destructuredUrl) pushed.push("pg"); // HIT
const withAssignment = (pushed.length = 0, process.env.PG_URL); // HIT
const constructed = new URL(process.env.PG_URL ?? "postgres://localhost"); // HIT
import requiredProcess = require("node:process");
if (requiredProcess.env.PG_URL) pushed.push("pg"); // HIT
