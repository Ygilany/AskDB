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
