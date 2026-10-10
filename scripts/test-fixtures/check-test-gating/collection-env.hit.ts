// The environment read where code runs while Vitest collects suites: anything here could change
// which suites or rows exist, so it fails. A test body, a hook, a plain `const` and
// integrationSuite()'s options may read it (collection-env.clean.ts).
import { afterEach as localAfterEach } from "./hooks";
const base = ["pg", "mysql"];
function engines() { return base; }
if (!process.env.DATABASE_URL) base.length = 0; // HIT
const forEachRows = ["pg", "mysql"];
forEachRows.forEach((_e, _i, all) => { if (!process.env.DATABASE_URL) all.length = 0; }); // HIT
const groups = [["pg", "mysql"]];
if (!process.env.DATABASE_URL) groups.at(0)!.length = 0; // HIT
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
[1].forEach(connect); // HIT
beforeAll([connect][0]); // HIT
describe(`named from ${process.env.ENGINE}`, () => {}); // HIT
const { PG_URL: destructuredUrl } = process.env;
if (destructuredUrl) pushed.push("pg"); // HIT
const withAssignment = (pushed.length = 0, process.env.PG_URL); // HIT
const constructed = new URL(process.env.PG_URL ?? "postgres://localhost"); // HIT
import requiredProcess = require("node:process");
if (requiredProcess.env.PG_URL) pushed.push("pg"); // HIT
const viaGetter = { get url() { return process.env.DATABASE_URL; } }; // HIT
const viaToString = { toString() { return process.env.DATABASE_URL ?? ""; } }; // HIT
const { PG_URL: withCallDefault = String(Date.now()) } = process.env; // HIT
import { createRequire } from "node:module";
const localRequire = createRequire(import.meta.url);
const viaCreateRequire = localRequire("node:process").env.PG_URL; // HIT
const requireAlias = require; // HIT
const viaRequireCall = require.call(null, "node:process"); // HIT
const moduleName = "node:process";
const byName = await import(moduleName); // HIT
const requiredByName = require(moduleName); // HIT
const mocked = await vi.importMock("node:process"); // HIT
const viaModuleRequire = module.require("node:process"); // HIT
if (global.process.env.PG_URL) pushed.push("pg"); // HIT
import bareProcess from "process";
if (bareProcess.env.PG_URL) pushed.push("pg"); // HIT
const plainSink = "";
let letPlain = "";
const getterHolder = { get value() { return "x"; } };
const templated = `${process.env.PG_URL}-${String(1)}`; // HIT
const stepped = process.env.PG_URL && ++plainSink; // HIT
const assigned = process.env.PG_URL ?? (plainSink = "y"); // HIT
const chosen = process.env.PG_URL ? String(1) : "b"; // HIT
const listed = [process.env.PG_URL, String(1)]; // HIT
const shorthandLet = { letPlain, url: process.env.PG_URL }; // HIT
const dynamicKey = process.env[moduleName]; // HIT
const readThroughGetter = getterHolder.value && process.env.PG_URL; // HIT
const cwdWithArgument = process.cwd(String(1)) && process.env.PG_URL; // HIT
const fromUndeclared = process.env.PG_URL ?? someGlobal; // HIT
const fromLet = process.env.PG_URL ?? letPlain; // HIT
