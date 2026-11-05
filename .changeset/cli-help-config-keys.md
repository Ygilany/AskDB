---
"askdb": patch
---

`askdb ask` and `askdb introspect` help, errors and the package README name the `askdb.config` keys that control each setting (`modes.askdbMode`, `dev.mockSql`, `logging.correlationId`, `introspection.outputDir`, `introspection.providerConfig.<engine>.databaseUrl`) instead of `ASKDB_*` and `DATABASE_URL` variables that AskDB never reads from the environment (#281). `askdb introspect --help` now lists every flag it accepts, including `--print`, `--diff`, `--engine`, `-v` and `--log-stdout`: the help and the parser are built from one flag table, and `--engine` lists the engines of the registry in use. `askdb introspect` also takes `--flag=value` like `--flag value`, as `askdb rag` does, and its argument errors no longer repeat a value, so a connection string passed as `--url=…` or as a stray argument stays out of the error.
