const run = () => {};
import * as vitest from "vitest";
register(vitest); // HIT
vitest[key].skip("computed namespace key", () => {}); // HIT
vitest[ok ? "describe" : "expect"]("namespace key chosen by a ternary", () => {}); // HIT
const { ...rest } = vitest; // HIT
const { [key]: picked } = vitest; // HIT
const { describe: { skip } } = vitest; // HIT
const viaRequire = require("vitest").describe; // HIT
import("vitest").then(({ describe }) => describe("through .then", run)); // HIT
let assigned;
assigned = await import("vitest"); // HIT
const [first] = await Promise.all([import("vitest")]); // HIT
await vi.importActual("vitest").then(({ describe }) => describe.skipIf(!process.env.DATABASE_URL)("vi.importActual through .then", run)); // HIT
const actualPromise = vi.importActual("vitest"); // HIT
await vi.importMock("vitest").then(({ describe }) => describe.skipIf(!process.env.DATABASE_URL)("vi.importMock through .then", run)); // HIT
await (vi.importActual as any)("vitest").then(({ describe }) => describe.skipIf(!process.env.DATABASE_URL)("a wrapped loader through .then", run)); // HIT
const { describe: plainKey, ...restOfVitest } = vitest; // HIT
const { it: plainIt, [key]: computedKey } = vitest; // HIT
register(import.meta.vitest); // HIT
const holder = { ns: vitest }; // HIT
class Holds { static ns = vitest; } // HIT
function withDefault(ns = vitest) {} // HIT
const loadedHolder = { ns: await import("vitest") }; // HIT
const { importActual: detachedActual } = vi; // HIT
const detachedLoader = vi.importActual; // HIT
const detachedByKey = vi["importMock"]; // HIT
(await vi.importActual.call(vi, "vitest")).describe.skipIf(!process.env.DATABASE_URL)("loader called through .call", (t) => { t("connects", () => {}); }); // HIT
const reflectedLoader = Reflect.get(vi, "importActual"); // HIT
const loaderKey = "importActual";
(await vi[loaderKey]("vitest")).describe.skipIf(!process.env.DATABASE_URL)("a loader read by a computed key", (t) => { t("connects", () => {}); }); // HIT
const { [loaderKey]: computedLoader } = vi; // HIT
import { vi as importedVi } from "vitest";
const importedReflected = Reflect.get(importedVi, "importMock"); // HIT
const nsReflected = Reflect.get(vitest.vi, "importActual"); // HIT
vitest.vi[loaderKey]("vitest"); // HIT
const { vi: destructuredVi } = vitest;
const destructuredReflected = Reflect.get(destructuredVi, "importMock"); // HIT
const requiredVi = require("vitest").vi; // HIT
const awaitedVi = (await import("vitest")).vi; // HIT
const inSourceVi = import.meta.vitest.vi; // HIT
import { vitest as vitestExport } from "vitest";
const exportReflected = Reflect.get(vitestExport, "importActual"); // HIT
const nsVitestExport = Reflect.get(vitest.vitest, "importMock"); // HIT
const { importActual: nsMemberActual } = vitest.vi; // HIT
const { vi: loadedVi } = await import("vitest");
const { importMock: aliasMock } = loadedVi; // HIT
