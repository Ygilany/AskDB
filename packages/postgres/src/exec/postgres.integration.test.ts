import { describe, expect, it } from "vitest";
import { executeReadOnlySelect } from "./postgres.js";

const url = process.env.DATABASE_URL;
const postgresSuite = url ? describe : describe.skip;

postgresSuite("executeReadOnlySelect (PostgreSQL)", () => {
  it("returns columns and rows for a simple SELECT", async () => {
    const result = await executeReadOnlySelect(url!, `SELECT 42::int AS n, 'ok'::text AS label`);
    expect(result.columns).toEqual(["n", "label"]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual([42, "ok"]);
  });
});
