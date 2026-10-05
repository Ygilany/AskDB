/**
 * Words each engine family reserves, from its own docs: the NL→SQL prompt lists a schema,
 * table or column with one of these names quoted (see `prompt-identifiers.ts`).
 *
 * Quoting a name that isn't reserved is harmless, so a list may be a superset; a word it
 * misses reaches the model unquoted. When an engine reserves a new word, add it here.
 * All lowercase.
 */

// Source: https://www.postgresql.org/docs/current/sql-keywords-appendix.html (PostgreSQL 18.6, fetched 2026-10-05). PostgreSQL column = "reserved" or "reserved (can be function or type)", incl. their ", requires AS" variants.
export const POSTGRES_RESERVED_WORDS: readonly string[] = [
  "all", "analyse", "analyze", "and", "any", "array", "as", "asc", "asymmetric", "authorization",
  "binary", "both", "case", "cast", "check", "collate", "collation", "column", "concurrently", "constraint",
  "create", "cross", "current_catalog", "current_date", "current_role", "current_schema", "current_time", "current_timestamp", "current_user", "default",
  "deferrable", "desc", "distinct", "do", "else", "end", "except", "false", "fetch", "for",
  "foreign", "freeze", "from", "full", "grant", "group", "having", "ilike", "in", "initially",
  "inner", "intersect", "into", "is", "isnull", "join", "lateral", "leading", "left", "like",
  "limit", "localtime", "localtimestamp", "natural", "not", "notnull", "null", "offset", "on", "only",
  "or", "order", "outer", "overlaps", "placing", "primary", "references", "returning", "right", "select",
  "session_user", "similar", "some", "symmetric", "system_user", "table", "tablesample", "then", "to", "trailing",
  "true", "union", "unique", "user", "using", "variadic", "verbose", "when", "where", "window",
  "with",
];

// Source: CockroachDB's grammar (pkg/sql/parser/sql.y): type/function-name keywords that Postgres
// doesn't reserve and a bare column name can't use. Its reserved keywords match the Postgres list.
export const COCKROACHDB_EXTRA_RESERVED_WORDS: readonly string[] = ["family", "none"];

// Source: https://dev.mysql.com/doc/refman/8.4/en/keywords.html (MySQL 8.4, words marked (R); matches information_schema.KEYWORDS on a MySQL 8.4.11 server) UNION https://mariadb.com/docs/server/reference/sql-structure/sql-language-structure/reserved-words (MariaDB main reserved-words table incl. version-tagged entries; Oracle-mode list excluded). Fetched 2026-10-05.
export const MYSQL_RESERVED_WORDS: readonly string[] = [
  "accessible", "add", "all", "alter", "analyze", "and", "as", "asc", "asensitive", "before",
  "between", "bigint", "binary", "blob", "both", "by", "call", "cascade", "case", "change",
  "char", "character", "check", "collate", "column", "condition", "constraint", "continue", "conversion", "convert",
  "create", "cross", "cube", "cume_dist", "current_date", "current_role", "current_time", "current_timestamp", "current_user", "cursor",
  "database", "databases", "day_hour", "day_microsecond", "day_minute", "day_second", "dec", "decimal", "declare", "default",
  "delayed", "delete", "delete_domain_id", "dense_rank", "desc", "describe", "deterministic", "distinct", "distinctrow", "div",
  "do_domain_ids", "double", "drop", "dual", "each", "else", "elseif", "empty", "enclosed", "escaped",
  "except", "exists", "exit", "explain", "false", "fetch", "first_value", "float", "float4", "float8",
  "for", "force", "foreign", "from", "fulltext", "function", "general", "generated", "get", "grant",
  "group", "grouping", "groups", "having", "high_priority", "hour_microsecond", "hour_minute", "hour_second", "if", "ignore",
  "ignore_domain_ids", "ignore_server_ids", "in", "index", "infile", "inner", "inout", "insensitive", "insert", "int",
  "int1", "int2", "int3", "int4", "int8", "integer", "intersect", "interval", "into", "io_after_gtids",
  "io_before_gtids", "is", "iterate", "join", "json_table", "key", "keys", "kill", "lag", "last_value",
  "lateral", "lead", "leading", "leave", "left", "like", "limit", "linear", "lines", "load",
  "localtime", "localtimestamp", "lock", "long", "longblob", "longtext", "loop", "low_priority", "master_heartbeat_period", "master_ssl_verify_server_cert",
  "match", "maxvalue", "mediumblob", "mediumint", "mediumtext", "middleint", "minute_microsecond", "minute_second", "mod", "modifies",
  "natural", "no_write_to_binlog", "not", "nth_value", "ntile", "null", "numeric", "of", "offset", "on",
  "optimize", "optimizer_costs", "option", "optionally", "or", "order", "out", "outer", "outfile", "over",
  "page_checksum", "parse_vcol_expr", "partition", "percent_rank", "precision", "primary", "procedure", "purge", "qualify", "range",
  "rank", "read", "read_write", "reads", "real", "recursive", "ref_system_id", "references", "regexp", "release",
  "rename", "repeat", "replace", "require", "resignal", "restrict", "return", "returning", "revoke", "right",
  "rlike", "row", "row_number", "rows", "schema", "schemas", "second_microsecond", "select", "sensitive", "separator",
  "set", "show", "signal", "slow", "smallint", "spatial", "specific", "sql", "sql_big_result", "sql_calc_found_rows",
  "sql_small_result", "sqlexception", "sqlstate", "sqlwarning", "ssl", "starting", "stats_auto_recalc", "stats_persistent", "stats_sample_pages", "stored",
  "straight_join", "system", "table", "tablesample", "terminated", "then", "tinyblob", "tinyint", "tinytext", "to",
  "to_date", "trailing", "trigger", "true", "undo", "union", "unique", "unlock", "unsigned", "update",
  "usage", "use", "using", "utc_date", "utc_time", "utc_timestamp", "values", "varbinary", "varchar", "varcharacter",
  "varying", "vector", "virtual", "when", "where", "while", "window", "with", "write", "xor",
  "year_month", "zerofill",
];

// Source: https://learn.microsoft.com/en-us/sql/t-sql/language-elements/reserved-keywords-transact-sql (view=sql-server-ver17, updated 2026-09-21, fetched 2026-10-05). Main "SQL Server and Azure Synapse Analytics" table only; doc entry "WITHIN GROUP" stored as "within".
export const SQLSERVER_RESERVED_WORDS: readonly string[] = [
  "add", "all", "alter", "and", "any", "as", "asc", "authorization", "backup", "begin",
  "between", "break", "browse", "bulk", "by", "cascade", "case", "check", "checkpoint", "close",
  "clustered", "coalesce", "collate", "column", "commit", "compute", "constraint", "contains", "containstable", "continue",
  "convert", "create", "cross", "current", "current_date", "current_time", "current_timestamp", "current_user", "cursor", "database",
  "dbcc", "deallocate", "declare", "default", "delete", "deny", "desc", "disk", "distinct", "distributed",
  "double", "drop", "dump", "else", "end", "errlvl", "escape", "except", "exec", "execute",
  "exists", "exit", "external", "fetch", "file", "fillfactor", "for", "foreign", "freetext", "freetexttable",
  "from", "full", "function", "goto", "grant", "group", "having", "holdlock", "identity", "identity_insert",
  "identitycol", "if", "in", "index", "inner", "insert", "intersect", "into", "is", "join",
  "key", "kill", "left", "like", "lineno", "load", "merge", "national", "nocheck", "nonclustered",
  "not", "null", "nullif", "of", "off", "offsets", "on", "open", "opendatasource", "openquery",
  "openrowset", "openxml", "option", "or", "order", "outer", "over", "percent", "pivot", "plan",
  "precision", "primary", "print", "proc", "procedure", "public", "raiserror", "read", "readtext", "reconfigure",
  "references", "replication", "restore", "restrict", "return", "revert", "revoke", "right", "rollback", "rowcount",
  "rowguidcol", "rule", "save", "schema", "securityaudit", "select", "semantickeyphrasetable", "semanticsimilaritydetailstable", "semanticsimilaritytable", "session_user",
  "set", "setuser", "shutdown", "some", "statistics", "system_user", "table", "tablesample", "textsize", "then",
  "to", "top", "tran", "transaction", "trigger", "truncate", "try_convert", "tsequal", "union", "unique",
  "unpivot", "update", "updatetext", "use", "user", "values", "varying", "view", "waitfor", "when",
  "where", "while", "with", "within", "writetext",
];

// Source: https://www.sqlite.org/lang_keywords.html (fetched 2026-10-05). Full keyword list.
export const SQLITE_KEYWORDS: readonly string[] = [
  "abort", "action", "add", "after", "all", "alter", "always", "analyze", "and", "as",
  "asc", "attach", "autoincrement", "before", "begin", "between", "by", "cascade", "case", "cast",
  "check", "collate", "column", "commit", "conflict", "constraint", "create", "cross", "current", "current_date",
  "current_time", "current_timestamp", "database", "default", "deferrable", "deferred", "delete", "desc", "detach", "distinct",
  "do", "drop", "each", "else", "end", "escape", "except", "exclude", "exclusive", "exists",
  "explain", "fail", "filter", "first", "following", "for", "foreign", "from", "full", "generated",
  "glob", "group", "groups", "having", "if", "ignore", "immediate", "in", "index", "indexed",
  "initially", "inner", "insert", "instead", "intersect", "into", "is", "isnull", "join", "key",
  "last", "left", "like", "limit", "match", "materialized", "natural", "no", "not", "nothing",
  "notnull", "null", "nulls", "of", "offset", "on", "or", "order", "others", "outer",
  "over", "partition", "plan", "pragma", "preceding", "primary", "query", "raise", "range", "recursive",
  "references", "regexp", "reindex", "release", "rename", "replace", "restrict", "returning", "right", "rollback",
  "row", "rows", "savepoint", "select", "set", "table", "temp", "temporary", "then", "ties",
  "to", "transaction", "trigger", "unbounded", "union", "unique", "update", "using", "vacuum", "values",
  "view", "virtual", "when", "where", "window", "with", "without",
];
