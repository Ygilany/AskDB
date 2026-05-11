import { describe, expect, it } from "vitest";
import { createPostgresCatalogQueryRunner } from "./postgres.js";

const url = process.env.DATABASE_URL;
const postgresSuite = url ? describe : describe.skip;

postgresSuite("createPostgresCatalogQueryRunner (PostgreSQL)", () => {
  it("returns columns and rows for a simple catalog-style SELECT", async () => {
    const runner = createPostgresCatalogQueryRunner(url!);
    const result = await runner(`SELECT 42::int AS n, 'ok'::text AS label`);
    expect(result.columns).toEqual(["n", "label"]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual([42, "ok"]);
  });
});
