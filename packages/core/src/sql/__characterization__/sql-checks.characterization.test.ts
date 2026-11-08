/**
 * Characterization of every SQL check's verdict, written for the #815 refactor (the checks' readings
 * in one module). It runs each check over a frozen corpus and every dialect setup, and compares the
 * result with a golden file that pins the current verdicts. The golden was captured on `main`
 * before the refactor, and the refactor left it unchanged except for #828, which it carries: 244
 * `tgk` verdicts no longer refuse a sorted or grouped query under a table named `order` or `group`.
 * Since then it has changed only on purpose: #623 (21 tenant verdicts, under `sqlserver`, the
 * custom engines and no dialect, where SQL Server ends a name or number), #665 (5 read-only verdicts on
 * `SELECT $1SELECT 2`, under the Postgres family and the custom engines), GHSA-rhwf-7742-8hwj
 * (70 tenant verdicts, all refusals: 31 close a keyword written right after a number with a decimal
 * point or exponent under `mysql` and `mariadb`, or after any number under the Postgres family; 3 refuse
 * `1=0xOR 1=1` under the Postgres family, which PostgreSQL rejects; and 36 refuse a `$N` parameter written
 * against a word wherever the SQL may be read as Postgres, rows the read-only check already refuses there
 * since #665 included), #399 (77 tenant verdicts, all refusals, every dialect: a predicate filters
 * only the reads of its own `SELECT`, a qualifier no read goes by counts for nothing, and a self-join's
 * reads must be told apart; its 43 rows below differ from the code before it in 344 tenant verdicts, all
 * refusals but 5 that keep a read filtered through its own quoted alias with a space, `"my alias"`),
 * and the readings fixed for beta.53 (196 verdicts, all refusals: 92 tenant and 104 keyword-table
 * verdicts, on the rows below and on one existing row under `sqlserver`, `"AGENCY_ID"` from a
 * cross-joined source; for a SQLite string name in a source's parentheses, `HAVING` on an ungrouped or
 * aliased column, a `BETWEEN`'s upper bound, a spaced qualifier dot, an `OR` after an alias spelled
 * like a clause word, and a column name the engine may read as another column; no other existing
 * verdict moves),
 * and #400 (no existing verdict moves; its 25 rows below differ from the code before it in 132 tenant
 * verdicts, every dialect: 108 refuse 9 shapes now that a join counts only on the columns the policy
 * declares, and on no ON in a SELECT with an outer join, and 24 accept 2 correct ones, a scoped table
 * joined to a filtered root's ID and `col IN (SELECT id FROM <root> WHERE id = :p)`), and the #623 review's
 * plain-code rule (62 tenant verdicts under `sqlserver`, all on SQL the read-only check already refuses there).
 *
 * Corpus: `sql-corpus.json` (every SQL string in the check tests at capture time) and the hostile
 * strings below. `vitest run -u` on this file accepts the new verdicts as the baseline, so run it
 * only for a verdict change you mean, and list the changed rows in the PR.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadSchema } from "../../schema/v2/loader.js";
import type { TenantScope } from "../../schema/v2/tenant-policy.js";
import { scanPlaceholders, tokenizeSqlSpans } from "../bind.js";
import {
  COCKROACHDB_DIALECT,
  MARIADB_DIALECT,
  MYSQL_DIALECT,
  POSTGRES_DIALECT,
  SQLITE_DIALECT,
  SQLSERVER_DIALECT,
  type DialectSpec,
} from "../dialect-spec.js";
import { findPostgresOnlyForms } from "../lexer.js";
import { validateSensitiveReferences } from "../sensitive-guardrail.js";
import { validateTenantGuardrails } from "../tenant-guardrail.js";
import { extractTenantPlaceholders } from "../tenant-placeholders.js";
import { validateSelectSql } from "../validate.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "../../../../../fixtures/schemas");
const tenantSchema = loadSchema(join(fixtures, "agency-multi-tenant.schema"));
const sensitiveSchema = loadSchema(join(fixtures, "orders-users-sensitive.schema"));
const policy = { ...tenantSchema.tenantPolicy!, enforcement: "warn" as const };
/** #828: tables named `order` and `group` left unclassified, as the multi-engine fixture leaves `billing.order`. */
const keywordTablesPolicy = {
  ...policy,
  coverage: [
    ...policy.coverage,
    { tableId: "table:billing.order", classification: "unknown" as const },
    { tableId: "table:app.group", classification: "unknown" as const },
  ],
};
const scope: TenantScope = { access: { kind: "ids", tenantRoot: "table:public.agencies", ids: ["42"] } };

const custom = (backslashEscapes?: boolean) =>
  ({ ...POSTGRES_DIALECT, id: "custom-engine", backslashEscapes }) as unknown as DialectSpec;

/** Every dialect setup the checks see. `undefined`: no dialect (the read-only check needs one). */
const DIALECTS: ReadonlyArray<readonly [string, DialectSpec | undefined]> = [
  ["postgres", POSTGRES_DIALECT],
  ["postgres+escapes", { ...POSTGRES_DIALECT, backslashEscapes: true }],
  ["cockroachdb", COCKROACHDB_DIALECT],
  ["mysql", MYSQL_DIALECT],
  ["mysql-escapes", { ...MYSQL_DIALECT, backslashEscapes: false }],
  // A MySQL spec that leaves backslashEscapes unset reads escapes on (GHSA-8pwj-6hfv-5pm4).
  ["mysql-unset", { ...MYSQL_DIALECT, backslashEscapes: undefined }],
  ["mariadb", MARIADB_DIALECT],
  ["sqlite", SQLITE_DIALECT],
  ["sqlserver", SQLSERVER_DIALECT],
  ["custom", custom()],
  ["custom+escapes", custom(true)],
  ["none", undefined],
];

/** Shapes where the readings may disagree: quoting, escapes, comments, prefixes, placeholders. */
const HOSTILE: readonly string[] = [
  String.raw`SELECT * FROM orders WHERE note = 'a\' AND agency_id = :tenant_agency_ids AND note = '`,
  String.raw`SELECT * FROM orders WHERE note = 'a\'' AND agency_id = :tenant_agency_ids`,
  String.raw`SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND note = 'it''s'`,
  // GHSA-8pwj-6hfv-5pm4: a MySQL spec with backslashEscapes unset reads the string with escapes on.
  String.raw`SELECT * FROM orders WHERE status = 'a\' AND agency_id = :tenant_agency_ids AND status = ' OR 1=1 OR status = ''`,
  String.raw`SELECT E'a\'b' AS x, o.* FROM orders o WHERE o.agency_id = :tenant_agency_ids`,
  "SELECT E'a'\n'\\'' AS x, o.* FROM orders o --'",
  String.raw`SELECT b'\'' AS x, o.* FROM orders o --'`,
  "SELECT b'a'\n'\\'' AS x, o.* FROM orders o --'",
  String.raw`SELECT (ARRAY[1,2])[1:b'\''] AS x, o.* FROM orders o --'`,
  String.raw`SELECT (ARRAY[1,2])[1:E'1'` + "\n'\\''::int] AS x --'",
  String.raw`SELECT U&"\006Frders".id FROM U&"\006Frders"`,
  String.raw`SELECT id FROM orders WHERE agency_id = :tenant_agency_ids AND U&"p\0061ssword" = 'x'`,
  String.raw`SELECT U&"secret\005Frecovery\005Ftoken" FROM users`,
  "SELECT $$ FROM orders $$ AS x FROM agencies WHERE id = :tenant_agency_ids",
  "SELECT $tag$ ' $tag$ AS x, o.* FROM orders o WHERE o.agency_id = :tenant_agency_ids",
  "SELECT $é$ FROM orders $é$ AS x FROM agencies WHERE id = :tenant_agency_ids",
  // GHSA-rmjw-pffc-5hjr: a dollar tag may hold non-ASCII letters, so `$é$ … $é$` is a string, as the engine reads it.
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND $é$'$é$ = '' OR 1=1 OR 'x' = 'x'",
  "SELECT $é$ a $é$ AS n, o.* FROM orders o WHERE o.agency_id = :tenant_agency_ids",
  "SELECT * FROM orders /* a /* nested */ WHERE agency_id = :tenant_agency_ids */",
  "SELECT * FROM orders /* note */ WHERE agency_id = :tenant_agency_ids",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids --1\nOR 1=1",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids -- c\nOR 1=1",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids # c\nOR 1=1",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids /*!50000 OR 1=1 */",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids /*M! OR 1=1 */",
  'SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND note = "x" OR "y"',
  'SELECT "agency_id" FROM orders WHERE "agency_id" = :tenant_agency_ids',
  "SELECT [agency_id] FROM orders WHERE [agency_id] = :tenant_agency_ids",
  "SELECT [a]]b] FROM orders WHERE agency_id = :tenant_agency_ids",
  "SELECT `agency_id` FROM orders WHERE `agency_id` = :tenant_agency_ids",
  "SELECT arr[1] FROM orders WHERE agency_id = :tenant_agency_ids",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids || 'x'",
  "SELECT * FROM orders WHERE note = ':tenant_agency_ids'",
  "SELECT * FROM orders WHERE note = 'x' -- :tenant_agency_ids",
  "SELECT * FROM orders WHERE agency_id = :TENANT_AGENCY_IDS",
  "SELECT * FROM orders WHERE agency_id IN (:tenant_agency_ids) AND status = :status",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids; DELETE FROM orders",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids\nEXEC xp_cmdshell 'x'",
  "SELECT 'unterminated FROM orders WHERE agency_id = :tenant_agency_ids",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids /* unterminated",
  "SELECT N'x' AS a, X'0a' AS b, B'01' AS c FROM orders WHERE agency_id = :tenant_agency_ids",
  "SELECT u.secret_recovery_token FROM users u",
  "SELECT 'u.secret_recovery_token' AS x FROM users u",
  String.raw`SELECT 'a\' AS x, u.secret_recovery_token FROM users u --'`,
  String.raw`SELECT E'a\'' AS x, u.secret_recovery_token FROM users u --'`,
  "SELECT $$ AS x, u.secret_recovery_token FROM users u $$",
  "SELECT x$$y, u.secret_recovery_token FROM users u, (SELECT 1 AS x$$y) t",
  "SELECT * FROM users",
  "SELECT row_to_json(u) FROM users u",
  // Where the tenant check's own scanner and the shared lexer split strings, names and comments differently.
  String.raw`SELECT 1e'\'' AS x, o.* FROM orders o WHERE o.agency_id = :tenant_agency_ids --'`,
  String.raw`SELECT $e'\'' AS x, o.* FROM orders o WHERE o.agency_id = :tenant_agency_ids --'`,
  "SELECT a$$b FROM orders WHERE agency_id = :tenant_agency_ids AND c$$d = 1",
  "SELECT * FROM agencies WHERE id = :tenant_agency_ids AND a$$b = 1 $$ OR 1=1",
  "SELECT $x$ AS v FROM orders WHERE agency_id = :tenant_agency_ids",
  "SELECT $x$ FROM orders",
  'SELECT "a""b" FROM orders WHERE "agency_id" = :tenant_agency_ids',
  'SELECT "a"" FROM orders WHERE agency_id = :tenant_agency_ids',
  "SELECT arr['orders'] FROM agencies WHERE id = :tenant_agency_ids",
  "SELECT `x'` FROM orders WHERE agency_id = :tenant_agency_ids --'",
  "SELECT [x'] FROM orders WHERE agency_id = :tenant_agency_ids --'",
  "SELECT [a]]b'] FROM orders WHERE agency_id = :tenant_agency_ids --'",
  "SELECT * FROM orders /*!50000 /* c */ WHERE agency_id = :tenant_agency_ids */",
  "SELECT * FROM agencies WHERE id = :tenant_agency_ids /* a /* b */ UNION SELECT * FROM orders */",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids /* a /* b */ OR 1=1 */",
  "SELECT 'a' 'b' FROM orders WHERE agency_id = :tenant_agency_ids",
  "SELECT N'a\\' AS x, o.* FROM orders o WHERE o.agency_id = :tenant_agency_ids --'",
  'SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND type = "agency"',
  "SELECT * FROM orders WHERE note = $q$ AND agency_id = :tenant_agency_ids AND $q$ = note",
  // #828: the words of ORDER BY and GROUP BY, and the spellings of a table named order or group.
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids ORDER BY id",
  "SELECT status, count(*) FROM orders WHERE agency_id = :tenant_agency_ids GROUP BY status ORDER BY status",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids ORDER /* c */ BY id",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids order\nby id",
  "SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY total) FROM orders WHERE agency_id = :tenant_agency_ids",
  'SELECT * FROM orders o JOIN billing."order" b ON b.id = o.id WHERE o.agency_id = :tenant_agency_ids ORDER BY o.id',
  'SELECT * FROM "order" ORDER BY id',
  "SELECT * FROM `order` ORDER BY id",
  "SELECT * FROM [order] ORDER BY id",
  "SELECT * FROM order o ORDER BY id",
  'SELECT * FROM orders WHERE agency_id = :tenant_agency_ids ORDER BY "order".id',
  'SELECT g.id FROM app."group" g GROUP BY g.id',
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids ORDER BY \"group\"",
  "SELECT * FROM orders WHERE note = E'\\'' AND agency_id = :tenant_agency_ids AND x = '",
  // A CR ends a `--`/`#` comment on Postgres and SQL Server, not on MySQL, SQLite or CockroachDB (GHSA-8pwj-6hfv-5pm4).
  "SELECT id FROM agencies WHERE id = :tenant_agency_ids --\rUNION ALL SELECT agency_id FROM orders",
  "SELECT * FROM orders WHERE 1=1 -- x\rAND agency_id = :tenant_agency_ids",
  "SELECT 1 AS a -- \r'\n, u.secret_recovery_token FROM users u -- '",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids # x\r OR 1=1",
  // #623: SQL Server ends a number after `0x` or `1E` and a name at U+00A0, U+200B and U+0085.
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND 1=1\u00a0OR 1=1",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND 1=1\u200bOR 1=1",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND 1=1\u0085OR 1=1",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND 1=0xOR 1=1",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND 1=1EOR 1=1",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND 1=1E OR 1=1",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND flags = 0x AND rate = 1E",
  "SELECT *\u00a0FROM orders\u00a0WHERE agency_id\u00a0=\u00a0:tenant_agency_ids",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids\u200bAND\u0085status = 'open'",
  "SELECT [x\u00a0OR] FROM orders WHERE agency_id = :tenant_agency_ids",
  // #399: each read of a scoped table needs a predicate in its own SELECT.
  "WITH mine AS (SELECT id FROM orders WHERE agency_id = :tenant_agency_ids) SELECT * FROM orders",
  "SELECT o.* FROM orders o CROSS JOIN (SELECT 1 FROM orders WHERE agency_id = :tenant_agency_ids) f",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND EXISTS (SELECT 1 FROM orders o2 WHERE o2.total > 5)",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND id IN (SELECT id FROM orders)",
  "SELECT o.* FROM orders o, (SELECT agency_id FROM orders WHERE agency_id = :tenant_agency_ids) t WHERE t.agency_id = :tenant_agency_ids",
  "SELECT b.* FROM orders a JOIN orders b ON a.id <> b.id WHERE a.agency_id = :tenant_agency_ids",
  "SELECT * FROM (SELECT id, total AS agency_id FROM orders) t WHERE t.agency_id = :tenant_agency_ids",
  "SELECT * FROM (SELECT id FROM orders) t WHERE agency_id = :tenant_agency_ids",
  "WITH x AS (SELECT * FROM orders) SELECT * FROM x WHERE agency_id = :tenant_agency_ids UNION ALL SELECT * FROM x",
  "SELECT name FROM agencies WHERE id = :tenant_agency_ids AND EXISTS (SELECT 1 FROM agencies a2 WHERE a2.name = 'x')",
  "WITH mine AS (SELECT id FROM orders WHERE agency_id = :tenant_agency_ids) SELECT * FROM orders WHERE agency_id = :tenant_agency_ids",
  "SELECT o.* FROM orders o CROSS JOIN (SELECT 1 FROM orders WHERE agency_id = :tenant_agency_ids) f WHERE o.agency_id = :tenant_agency_ids",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND id IN (SELECT id FROM orders WHERE agency_id = :tenant_agency_ids)",
  "SELECT * FROM (SELECT o.id, o.agency_id FROM orders o) t WHERE t.agency_id = :tenant_agency_ids",
  "WITH x AS (SELECT * FROM orders) SELECT * FROM x WHERE x.agency_id = :tenant_agency_ids",
  "SELECT * FROM orders o WHERE o.agency_id = :tenant_agency_ids AND EXISTS (SELECT 1 FROM lookup_states d WHERE d.code = o.state)",
  "SELECT b.* FROM orders a JOIN orders b ON a.id = b.parent_id WHERE a.agency_id = :tenant_agency_ids AND b.agency_id = :tenant_agency_ids",
  // #399: an aliased read goes by its alias, an unseen qualifier counts for nothing, and a source
  // with a column list, a computation over its rows or a parenthesized join isn't followed from outside.
  "SELECT b.* FROM orders JOIN orders b ON b.id <> orders.id WHERE orders.agency_id = :tenant_agency_ids",
  "SELECT o.* FROM orders o CROSS JOIN generate_series(1, 100) AS g(agency_id) WHERE g.agency_id = :tenant_agency_ids",
  "WITH x (id, agency_id) AS (SELECT id, agency_id FROM orders) SELECT * FROM x WHERE agency_id = :tenant_agency_ids UNION ALL SELECT * FROM x",
  "SELECT * FROM (SELECT o.*, sum(o.total) OVER () AS grand_total FROM orders o) t WHERE t.agency_id = :tenant_agency_ids",
  "SELECT * FROM (SELECT * FROM (orders o JOIN orders b ON 1=1)) t WHERE t.agency_id = :tenant_agency_ids",
  // #399: a word after a read that may be an alias leaves it unnamed, a column list on a
  // source's alias or a CTE reference isn't followed, names the engine tells apart stay apart, and `*`
  // sees past an alias spelled like a clause.
  "SELECT force.* FROM orders force, orders WHERE orders.agency_id = :tenant_agency_ids",
  "SELECT * FROM (SELECT total, agency_id FROM orders) AS lock (agency_id, x) WHERE lock.agency_id = :tenant_agency_ids",
  "WITH x AS (SELECT total, agency_id FROM orders) SELECT * FROM x AS t (agency_id, real_agency) WHERE t.agency_id = :tenant_agency_ids",
  "SELECT \"A\".* FROM orders \"A\" JOIN orders a ON true WHERE a.agency_id = :tenant_agency_ids",
  "SELECT A.* FROM orders A JOIN orders a ON true WHERE a.agency_id = :tenant_agency_ids",
  "SELECT * FROM orders O WHERE o.agency_id = :tenant_agency_ids",
  "SELECT * FROM (SELECT * FROM orders lock, orders b) t WHERE t.agency_id = :tenant_agency_ids",
  "WITH x AS MATERIALIZED (SELECT * FROM orders) SELECT * FROM x WHERE agency_id = :tenant_agency_ids",
  // #399: a quoted identifier is one name, a table alone in parentheses takes the alias after them,
  // and a reading that sees a scoped table's name but no read of it fails closed.
  "SELECT * FROM orders [.]",
  "SELECT \"b a\".* FROM orders \"b a\" CROSS JOIN orders b WHERE b.agency_id = :tenant_agency_ids",
  "SELECT * FROM (SELECT total, agency_id FROM orders) AS \"t x\" (agency_id, real_agency) WHERE agency_id = :tenant_agency_ids",
  "SELECT a.* FROM ONLY (orders) a, orders WHERE orders.agency_id = :tenant_agency_ids",
  "SELECT * FROM orders \"my alias\" WHERE \"my alias\".agency_id = :tenant_agency_ids",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids UNION ALL SELECT * FROM [orders ]",
  "SELECT json_agg(orders) AS data FROM orders WHERE orders.agency_id = :tenant_agency_ids",
  // #399: only canonical forms name a read, and a subquery is a row source only where a source starts.
  "SELECT * FROM orders TABLESAMPLE SYSTEM (100), orders AS \"tablesample\" WHERE \"tablesample\".agency_id = :tenant_agency_ids",
  "SELECT o.* FROM orders o JOIN lookup_states s ON (SELECT agency_id FROM orders x WHERE x.total > 5) = 7 WHERE agency_id = :tenant_agency_ids",
  // #399: a FROM that opens no FROM clause starts no source, and a SELECT that reads a
  // table twice tells its reads apart only by distinct plain aliases and alias-qualified predicates.
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND 2 IS NOT DISTINCT FROM (SELECT agency_id FROM orders x WHERE x.id = 99)",
  "SELECT j.* FROM (orders o CROSS JOIN lookup_states s) AS j CROSS JOIN orders o WHERE o.agency_id = :tenant_agency_ids",
  "SELECT b.* FROM agencies a, agencies b WHERE a.id IN (SELECT agency_id FROM orders WHERE agency_id = :tenant_agency_ids)",
  "SELECT * FROM orders a, orders b WHERE agency_id = :tenant_agency_ids",
  // #665: a `$N` parameter written against a word, refused where the SQL may be read as Postgres.
  "SELECT $1INTO lab_x",
  "SELECT order_id FROM billing.order_line WHERE order_id = $1FOR SHARE",
  // GHSA-rhwf-7742-8hwj: a keyword written right after a number or a $N parameter.
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND 1=1.0OR 1=1",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND 1=1e1OR 1=1",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND 1=.5OR 1=1",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND 1=1.XOR 1=1",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND 1=1OR 1=1",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND 0 < $1OR TRUE",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND 1=1.0 OR 1=1",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND total > 1.5 AND total < 1e3",
  // SQL Server reads `]]` in a bracketed name as `]`; SQL Server, Postgres and CockroachDB nest block comments.
  "SELECT * FROM orders AS [o]] WHERE agency_id = :tenant_agency_ids AND [x]",
  "SELECT * FROM orders WHERE 1=1 /* /* */ AND agency_id = :tenant_agency_ids AND 1=1 -- */",
  // A name outside printable ASCII, which SQL Server's collation may fold to a table or column in the schema.
  "SELECT * FROM [ｏｒｄｅｒｓ]",
  'SELECT * FROM "ｏｒｄｅｒｓ"',
  "SELECT * FROM ｏｒｄｅｒｓ",
  "SELECT * FROM [ord‍ers]",
  "SELECT * FROM public.[ord﻿ers]",
  "SELECT [secret‍_recovery_token] FROM users",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids AND status = N'ｏｐｅｎ'",
  // A column list after a table's alias renames the table's columns on Postgres and CockroachDB.
  "SELECT * FROM orders t (agency_id, x) WHERE t.agency_id = :tenant_agency_ids",
  "SELECT * FROM orders AS t (agency_id, x) WHERE agency_id = :tenant_agency_ids",
  "SELECT * FROM (SELECT * FROM orders t (agency_id, x) WHERE t.agency_id = :tenant_agency_ids) d",
  "SELECT o.* FROM orders o (NOLOCK) WHERE o.agency_id = :tenant_agency_ids",
  "SELECT * FROM (orders o JOIN lookup_states s ON true) AS j (a1, a2, agency_id) WHERE agency_id = :tenant_agency_ids",
  "SELECT * FROM (orders o JOIN lookup_states s ON true) j (a1, a2, agency_id) WHERE agency_id = :tenant_agency_ids",
  "SELECT * FROM (orders o JOIN lookup_states s ON true) AS j WHERE agency_id = :tenant_agency_ids",
  // A join with LEFT, RIGHT or FULL anywhere in it is outer, whatever hint sits beside it.
  "SELECT o.* FROM orders o LEFT STRAIGHT JOIN lookup_states x ON x.code = o.state AND o.agency_id = :tenant_agency_ids",
  "SELECT o.* FROM orders o LEFT LOOKUP JOIN lookup_states x ON x.code = o.state AND o.agency_id = :tenant_agency_ids",
  "SELECT o.* FROM lookup_states x RIGHT STRAIGHT JOIN orders o ON x.code = o.state AND o.agency_id = :tenant_agency_ids",
  "SELECT o.* FROM orders o INNER STRAIGHT JOIN lookup_states x ON x.code = o.state AND o.agency_id = :tenant_agency_ids",
  "SELECT o.* FROM orders o LEFT JOIN lookup_states x JOIN service_types s ON s.id = x.id ON x.code = o.state AND o.agency_id = :tenant_agency_ids",
  // Postgres compares a quoted name exactly, so "AGENCY_ID" is another column.
  'SELECT o.* FROM orders o CROSS JOIN (SELECT 42 AS "AGENCY_ID") x WHERE "AGENCY_ID" = :tenant_agency_ids',
  // A quoted name spelled like a placeholder is a name, and a U+0001 inside a quoted name is part of it.
  'SELECT o.* FROM orders o CROSS JOIN LATERAL (SELECT o.agency_id AS ":tenant_agency_ids") x WHERE o.agency_id = ":tenant_agency_ids"',
  "SELECT o.* FROM orders o CROSS JOIN LATERAL (SELECT o.agency_id AS `:tenant_agency_ids`) x WHERE o.agency_id = `:tenant_agency_ids`",
  "SELECT o.* FROM orders o CROSS APPLY (SELECT o.agency_id AS [:tenant_agency_ids]) x WHERE o.agency_id = [:tenant_agency_ids]",
  'SELECT "\u0001".a FROM orders CROSS JOIN (SELECT 1 AS a) "\u0001" WHERE agency_id = :tenant_agency_ids AND "\u0001".a = 1 OR 1=1',
  "SELECT [\u0001].a FROM orders CROSS JOIN (SELECT 1 AS a) [\u0001] WHERE agency_id = :tenant_agency_ids AND [\u0001].a = 1 OR 1=1",
  // SQLite reads a '…' literal in a table's place as the table's name.
  "SELECT * FROM 'orders'",
  "SELECT * FROM orders WHERE agency_id = :tenant_agency_ids UNION ALL SELECT * FROM 'orders'",
  "SELECT * FROM lookup_states, main.'orders'",
  "SELECT * FROM 'users'",
  "SELECT 'orders' AS label, o.* FROM orders o WHERE o.agency_id = :tenant_agency_ids",
  "SELECT orders.* FROM sub_agencies 'o', orders WHERE o.agency_id = :tenant_agency_ids",
  "SELECT x.* FROM orders 'x', orders WHERE orders.agency_id = :tenant_agency_ids",
  "WITH t AS (SELECT * FROM orders) SELECT y.* FROM t 'y', t WHERE t.agency_id = :tenant_agency_ids",
  "SELECT x.* FROM orders 'x' WHERE x.agency_id = :tenant_agency_ids",
  // #400: a join counts only on the columns the policy declares.
  "SELECT a.* FROM appointments a JOIN sub_agencies s ON a.client_id = s.id WHERE s.agency_id = :tenant_agency_ids",
  "SELECT a.* FROM appointments a JOIN clients c ON a.client_id = c.id JOIN sub_agencies s ON c.sub_agency_id = s.id WHERE s.agency_id = :tenant_agency_ids",
  "SELECT a.* FROM appointments a JOIN clients c ON a.id = c.id JOIN sub_agencies s ON c.sub_agency_id = s.id WHERE s.agency_id = :tenant_agency_ids",
  "SELECT a.client_id FROM appointments a, clients c, sub_agencies s WHERE s.agency_id = :tenant_agency_ids",
  "SELECT a.* FROM appointments a LEFT JOIN clients c ON a.client_id = c.id LEFT JOIN sub_agencies s ON c.sub_agency_id = s.id WHERE s.agency_id = :tenant_agency_ids",
  "SELECT a.name FROM agencies a JOIN orders o ON a.id = o.total WHERE o.agency_id = :tenant_agency_ids",
  "SELECT a.name, o.id FROM agencies a, orders o WHERE o.agency_id = :tenant_agency_ids",
  "SELECT name FROM agencies WHERE id IN (SELECT total FROM orders WHERE agency_id = :tenant_agency_ids)",
  "SELECT name FROM agencies WHERE id IN (SELECT agency_id FROM orders WHERE agency_id = :tenant_agency_ids)",
  "SELECT o.* FROM orders o JOIN agencies a ON a.id = o.agency_id WHERE a.id = :tenant_agency_ids",
  "SELECT * FROM orders o WHERE o.agency_id IN (SELECT id FROM agencies WHERE id = :tenant_agency_ids)",
  // #400 review: an inner ON doesn't filter beside an outer join, and a source named like a policy table isn't it.
  "SELECT o.* FROM agencies a JOIN campaigns m ON m.owning_agency = a.id AND a.id = :tenant_agency_ids RIGHT JOIN orders o ON o.agency_id = a.id",
  "SELECT o.* FROM orders o LEFT JOIN (agencies a JOIN campaigns m ON m.owning_agency = a.id AND a.id = :tenant_agency_ids) ON o.agency_id = a.id",
  "SELECT o.* FROM orders o LEFT JOIN agencies g JOIN sub_agencies s ON s.agency_id = g.id ON o.agency_id = :tenant_agency_ids",
  "SELECT a.* FROM appointments a JOIN (SELECT 1 AS id, s.agency_id AS sub_agency_id FROM sub_agencies s WHERE s.agency_id = :tenant_agency_ids) clients ON a.client_id = clients.id WHERE clients.sub_agency_id = :tenant_agency_ids",
  // #400 review, round 2: an outer ON links only across the join, a FROM inside a call opens no FROM clause, a CTE
  // with a column list shadows its table, and a parenthesized join group, STRAIGHT_JOIN and a comma after a join read tables.
  "SELECT o.* FROM orders o LEFT JOIN lookup_states ls ON o.agency_id = o.id WHERE o.id = :tenant_agency_ids",
  "SELECT a.* FROM appointments a JOIN (SELECT 1 AS id, s.agency_id AS sub_agency_id, 0 AS clients FROM sub_agencies s) clients ON a.client_id = clients.id WHERE clients.sub_agency_id = :tenant_agency_ids AND 1 IS DISTINCT FROM clients",
  "WITH clients (id, sub_agency_id) AS (SELECT 1, 5) SELECT a.* FROM appointments a JOIN clients k ON a.client_id = k.id WHERE k.sub_agency_id = :tenant_agency_ids",
  "SELECT a.* FROM appointments a JOIN (clients c JOIN sub_agencies s ON c.sub_agency_id = s.id) ON a.client_id = c.id WHERE s.agency_id = :tenant_agency_ids",
  "SELECT a.* FROM clients c JOIN sub_agencies s ON c.sub_agency_id = s.id, appointments a WHERE a.client_id = c.id AND s.agency_id = :tenant_agency_ids",
  "SELECT o.* FROM agencies a JOIN campaigns m ON m.owning_agency = a.id AND a.id = :tenant_agency_ids RIGHT STRAIGHT JOIN orders o ON o.agency_id = a.id",
  // #400 review, round 3: an ON column names only its join's operands, no ON equality counts beside an
  // outer join, and a CTE name drops its trailing spaces.
  "SELECT o.* FROM orders o, (SELECT 5 AS agency_id) d JOIN lookup_states ls ON agency_id = :tenant_agency_ids",
  "SELECT o.* FROM orders o CROSS JOIN agencies g LEFT JOIN campaigns m ON m.owning_agency = g.id AND m.owning_agency = o.agency_id WHERE g.id = :tenant_agency_ids",
  "SELECT o.* FROM orders o CROSS JOIN agencies g LEFT JOIN lookup_states ls ON o.agency_id = g.id WHERE g.id = :tenant_agency_ids",
  "WITH [clients ] AS (SELECT 1 AS id, 5 AS sub_agency_id) SELECT a.* FROM appointments a JOIN clients k ON a.client_id = k.id JOIN sub_agencies s ON k.sub_agency_id = s.id WHERE s.agency_id = :tenant_agency_ids",
  // A SQLite string name in a source's parentheses, HAVING on a GROUP BY key, the AND of a BETWEEN,
  // a spaced qualifier dot, and an OR after an alias spelled like a clause word.
  "SELECT * FROM ('orders')",
  "SELECT x.* FROM (orders) 'x', sub_agencies orders WHERE orders.agency_id = :tenant_agency_ids",
  "SELECT agency_id, count(*), sum(total) FROM orders HAVING agency_id = :tenant_agency_ids",
  "SELECT o.total AS agency_id, count(*) FROM orders o GROUP BY agency_id HAVING agency_id = :tenant_agency_ids",
  "SELECT agency_id, count(*) FROM orders GROUP BY agency_id HAVING agency_id = :tenant_agency_ids",
  "SELECT o.* FROM orders o WHERE 0 BETWEEN 0 AND o.agency_id IN (:tenant_agency_ids)",
  "SELECT * FROM orders WHERE total BETWEEN 1 AND 5 AND agency_id = :tenant_agency_ids",
  "SELECT by.order_id, by.agency_id FROM billing . order by",
  "SELECT * FROM orders lock WHERE agency_id = :tenant_agency_ids AND lock.id > 0 OR 1 = 1",
  "SELECT * FROM orders limit WHERE agency_id = :tenant_agency_ids AND limit.id > 0 OR 1 = 1",
  "SELECT * FROM (lookup_states, 'orders')",
  "SELECT o.* FROM orders o WHERE 0 BETWEEN LEFT('0', 1) AND o.agency_id IN (:tenant_agency_ids)",
  // A column name the engine reads as another column, read the Postgres way: a discriminator, its
  // control, and a derived table's column.
  `SELECT n.* FROM notes n, (SELECT 'agency' AS "OWNER_TYPE") z WHERE "OWNER_TYPE" = 'agency' AND n.owner_id = :tenant_agency_ids`,
  "SELECT o.* FROM orders o WHERE o.AGENCY_ID = :tenant_agency_ids",
  `SELECT x.* FROM (SELECT o.id, "AGENCY_ID" AS agency_id FROM orders o, (SELECT generate_series(1, 100000) AS "AGENCY_ID") z) x WHERE x.agency_id = :tenant_agency_ids`,
];

function verdicts(sql: string, dialect: DialectSpec | undefined): string {
  const parts: string[] = [];
  const attempt = (label: string, run: () => string) => {
    try {
      parts.push(`${label}=${run()}`);
    } catch (e) {
      const err = e as { rule?: string; name?: string; warnings?: Array<{ rule: string; tableId: string }> };
      parts.push(`${label}!${err.rule ?? err.name ?? "error"}${err.warnings ? `[${err.warnings.map((w) => `${w.rule}:${w.tableId}`).sort().join(",")}]` : ""}`);
    }
  };
  if (dialect) attempt("ro", () => (validateSelectSql(dialect, sql), "ok"));
  attempt("tg", () => {
    const r = validateTenantGuardrails(sql, policy, scope, { dialect });
    return r.warnings.map((w) => `${w.rule}:${w.tableId}`).sort().join(",") || "ok";
  });
  attempt("tgk", () => {
    const r = validateTenantGuardrails(sql, keywordTablesPolicy, scope, { dialect });
    return r.warnings.map((w) => `${w.rule}:${w.tableId}`).sort().join(",") || "ok";
  });
  attempt("sens", () => {
    const r = validateSensitiveReferences(sql, sensitiveSchema, dialect ? { dialect } : undefined);
    const refs = r.references.map((x) => `${x.table}.${x.column ?? "*"}:${x.matchKind}`).sort().join(",");
    return `${r.passed ? "pass" : "fail"}[${refs}]${r.unresolvedScope ? `{${r.unresolvedScope.issues.join(",")}}` : ""}`;
  });
  attempt("pg", () => {
    const f = findPostgresOnlyForms(sql, dialect);
    return [f.unicodeEscapedIdentifier ? "U&" : "", f.escapeStringContinuation ? "E-cont" : "", f.escapedByteString ? "b-esc" : ""].filter(Boolean).join(",") || "-";
  });
  attempt("spans", () => tokenizeSqlSpans(sql, dialect).map((s) => `${s.kind === "comment" ? "m" : s.kind[0]}${s.start}-${s.end}`).join(" "));
  attempt("ph", () => scanPlaceholders(sql, dialect).map((p) => p.name).join(","));
  attempt("tph", () => extractTenantPlaceholders(sql, dialect).join(","));
  return parts.join(" | ");
}

// One test runs the whole corpus under every dialect: about 3 s on a laptop, but 22–46 s on CI's runners, past the 45 s default.
describe("SQL checks: characterization for #815", () => {
  it("gives every verdict the golden file records", { timeout: 120_000 }, async () => {
    const corpus = [...new Set([...(JSON.parse(readFileSync(join(here, "sql-corpus.json"), "utf8")) as string[]), ...HOSTILE])];
    const golden: Record<string, Record<string, string>> = {};
    for (const sql of corpus) {
      golden[sql] = Object.fromEntries(DIALECTS.map(([label, dialect]) => [label, verdicts(sql, dialect)]));
    }
    await expect(`${JSON.stringify(golden, null, 1)}\n`).toMatchFileSnapshot("./sql-checks.golden.json");
  });
});
