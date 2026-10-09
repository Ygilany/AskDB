import * as vitest from "vitest";
register(vitest); // HIT
vitest[key].skip("computed namespace key", () => {}); // HIT
vitest[ok ? "describe" : "expect"]("namespace key chosen by a ternary", () => {}); // HIT
const { ...rest } = vitest; // HIT
const { [key]: picked } = vitest; // HIT
const { describe: { skip } } = vitest; // HIT
