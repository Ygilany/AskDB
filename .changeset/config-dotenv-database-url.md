---
"askdb": patch
"@askdb/studio": patch
---

Drop dotenv from generated config; use DATABASE_URL universally; generate .env.example with placeholder connection strings.

`askdb init` and the Studio setup wizard no longer emit `import dotenv` or install `dotenv` explicitly — `bootstrapAskDbEnv()` already loads `.env` before evaluating the config file, and `dotenv` is already a transitive dependency of `@askdb/config`.

All network database providers (postgres, mysql, sqlserver) now default to `DATABASE_URL` instead of provider-specific names like `MYSQL_URL` or `SQLSERVER_URL`.

Both `askdb init` and the Studio wizard now generate a `.env.example` alongside `askdb.config.ts`, pre-populated with a ready-to-copy placeholder connection string in the correct format for the selected database (postgresql:// URI, mysql:// URI, or MSSQL ADO.NET connection string).
