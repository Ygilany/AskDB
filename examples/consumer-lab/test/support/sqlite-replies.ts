/**
 * Authored SQLite replies the record and grade tests build their inputs from, copied from
 * `cassettes/sqlite/` when those were still hand-written. `pnpm lab:record` replaces the
 * committed cassettes with model replies whose fences, SQL and manifest layout differ, so the
 * tests keep their own copies instead of reading the cassettes they would then depend on.
 * Plain data: nothing here is checked against the cassettes.
 */
export const AUTHORED_SQLITE_REPLIES = {
  "agency-names": "```sql\nSELECT agency_id, name\nFROM agency\nORDER BY agency_id\n```",
  "top-five-orders": "```sql\nSELECT order_id, total\nFROM \"order\"\nORDER BY total DESC, order_id\nLIMIT 5\n```",
  "programs-started-since": "```sql\nSELECT agency_id, program_code\nFROM program\nWHERE starts_on >= '2022-01-01'\nORDER BY agency_id, program_code\n```\n\n```sql-unbound\nSELECT agency_id, program_code\nFROM program\nWHERE starts_on >= :start_date\nORDER BY agency_id, program_code\n```\n\n```json\n{\"parameters\":[{\"name\":\"start_date\",\"type\":\"date\",\"cardinality\":\"one\",\"description\":\"The earliest program start date to include\",\"value\":\"2022-01-01\"}]}\n```",
} as const;
