require("vitest").describe("an ungated suite through require", () => {});
(await import("vitest") as any).describe("an ungated suite through a cast import", () => {});
resolve("vitest");
type Describe = typeof import("vitest").describe;
const notARequire = mod.other(import.meta.url);
notARequire("vitest").describe.skip("not a createRequire function", run);
