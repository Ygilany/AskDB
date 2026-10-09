require("vitest").describe("an ungated suite through require", () => {});
(await import("vitest") as any).describe("an ungated suite through a cast import", () => {});
resolve("vitest");
