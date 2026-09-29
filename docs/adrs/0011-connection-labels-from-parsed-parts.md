# ADR 0011 — Connection labels are built from parsed parts, never by masking

## Status

Accepted (2026-09-29).

## Context

AskDB shows a label for a configured database connection: Studio serves one as `sourceLabel` from `GET /api/introspect/status`, and the engine packages expose the function that builds it. The connection string behind the label usually carries a password, so the label must never contain one.

Studio first built the label with `new URL()` and printed `protocol//host/path`. For the SQL Server Prisma/JDBC form (`sqlserver://host;database=db;user=sa;password=S3cret`) the non-special scheme parses with an opaque host, so the whole `;password=…` tail was shown. #189 replaced it with denylist masking: find each secret (URL userinfo, `password=`-like keys, SQLite `key=` params) and replace it with `****`, keeping the rest of the string. Three independent review rounds each found a new way past the masking:

1. **Round 1.** A password containing an unencoded `/`, `?` or `#` ended the URL authority before the `@`, so no userinfo was found and the input came back unchanged (`postgres://app:pa/ss@db:5432/app`, `mysql://root:pa/ss@db:3306/shop`, `mssql://sa:S3/cret@host:1433/db`). In the Prisma form, a password containing `@` turned the port's `:` into the start of "userinfo", which masked the port and left the rest of the password visible (`sqlserver://host:1433;…;password=p@ssw0rd` → `sqlserver://host:****@ssw0rd`).
2. **Round 2.** Leading whitespace hid a URL from scheme detection (` postgres://u:secret@h/db` came back unchanged). An unescaped separator in an unquoted password (`Password=ab;cd;Database=x`) masked only `ab`. SQLite `file:` URIs carried `key=` / `hexkey=` encryption keys in the query string, which nothing masked.
3. **Round 3.** A quoted or braced value followed by more text leaked the tail (`?password='ab'cd` → `?password=****cd`, same for `Password={ab}cd;`). JDBC and near-miss URL forms were not recognised as URLs, so they came back unchanged (`jdbc:postgresql://u:secret@h/db`, a quoted URL, `postgres:/u:secret@h/db`, `sqlserver://sa:se;cret@h`). A percent-encoded SQLite key name (`file:app.db?%6Bey=secret`) did not match the key denylist.

Every fix added another rule to recognise one more way a secret can be spelled, and every round found a spelling the rules missed. The failure is structural: masking copies everything it does not recognise as a secret, so any unrecognised spelling leaks.

## Options considered

### Option A — Build the label only from parts that parsed cleanly (chosen)

Each engine parses its own connection-string formats into a small set of parts known to be safe to show: host, port and database, or a file path for SQLite. A shared builder turns those parts into a label and checks each part against an allowlist (hostname characters, digits for the port, identifier characters for the database, no `? # ; = @` or control characters in a file path). If the input does not parse cleanly, or any part fails its allowlist, the label is `configured <engine> connection`. No substring of the input outside those parsed parts is ever copied.

A new spelling of a secret can no longer leak: the label never contains text the parser did not deliberately extract and the allowlist did not accept. The cost is that some legitimate strings (a libpq `key=value` DSN, a SQL Server named instance, a Prisma string with `user=name@server`) get the fallback label instead of a host and database.

### Option B — Denylist masking (rejected)

Find the secret and replace it with `****`, as #189 did. Rejected because of the three rounds above: masking fails open. Each new spelling (an unencoded reserved character, whitespace, a quote followed by text, a JDBC prefix, percent-encoding) leaks until someone finds it and adds a rule. The concrete bypasses are listed in the context section; each is now a row in the label tests.

### Option C — Engine-only label, no host or database (rejected)

Always show `configured <engine> connection`. This can never leak and needs no parsing. Rejected because the label exists to tell the user which database Studio is about to introspect; "configured postgres connection" can't distinguish staging from production. Option A gives the same guarantee for every input that doesn't parse cleanly, and still shows the host and database for the ordinary strings that do. The extra risk A takes is limited to what the parser extracts, and the allowlist bounds even that.

## Decision

Option A.

- **Parsing is engine knowledge.** Each engine package owns the parser for its formats: `@askdb/postgres` and `@askdb/mysql` (URLs), `@askdb/sqlserver` (`mssql://` URLs, the Prisma/JDBC `sqlserver://host:port;key=value` form, and ADO.NET `key=value;` strings), `@askdb/sqlite` (plain paths and `file:` URIs, reading only the path). Each exports `connectionLabel(input)`.
- **The standard URL parser and the builder are shared.** `parseConnectionUrl(input, schemes)` (used by Postgres, MySQL and SQL Server's `mssql://`) and `formatConnectionLabel(engine, parts)` live in the shared package the engines already depend on (`@askdb/connectors` today).
- **Parsers are strict.** They return nothing, so the label falls back, for another scheme, whitespace, a `#`, an `@` anywhere after the URL authority (a password containing `/`, `?` or `#` makes the end of the userinfo unknown), a multi-segment path, a quoted or braced value followed by text, a segment that isn't `key=value`, a repeated key, or an `@` in the SQL Server `sqlserver://` form (which has no userinfo).
- **No user name.** Labels show host, port and database only. The pre-#189 Studio label (`protocol//host/path`) did not show the user either, and no documented output depends on it.
- **Apps don't parse connection strings.** Studio (and any other host) gets the label from the engine's function; it never inspects the raw string itself.

## Consequences

- Labels look like `postgres://db:5432/app`, `sqlserver://db:1433/app`, `./data/app.db`, or `configured <engine> connection`. The scheme is the engine id, not the input's scheme (`postgresql://` and `mssql://` inputs show `postgres://` and `sqlserver://`).
- Some valid strings get the fallback label: libpq keyword/value DSNs, Postgres multi-host URLs, percent-encoded socket hosts, SQL Server named instances (`host\instance`), `sqlserver://` strings containing `@` (such as `user=admin@server`), and any URL whose query contains `@`. Supporting one of them means extending that engine's parser to extract its parts cleanly, with test rows.
- Every leak input from the three review rounds is a row in the engine label tests (`packages/<engine>/src/label.test.ts`) and in the Studio route test for `GET /api/introspect/status`.
- A future contributor must not:
  - reintroduce masking or any denylist of secret key names for labels, including as a "fallback" for inputs the parser doesn't handle (the fallback is `configured <engine> connection`);
  - copy any substring of the input into a label other than a part the parser extracted and `formatConnectionLabel` accepted (no "keep the rest of the string", no query parameters, no user name);
  - loosen a part's allowlist (the character classes in `formatConnectionLabel`) without amending this ADR;
  - parse connection strings in an app. A new format goes into the owning engine package's parser.
