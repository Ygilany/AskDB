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
