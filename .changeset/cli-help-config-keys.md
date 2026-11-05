---
"askdb": patch
---

`askdb ask` and `askdb introspect` help and errors name the `askdb.config` keys that control each setting (`modes.askdbMode`, `dev.mockSql`, `logging.correlationId`, `introspection.outputDir`, `introspection.providerConfig.<engine>.databaseUrl`) instead of `ASKDB_*` and `DATABASE_URL` variables that AskDB never reads from the environment. `askdb introspect --help` now lists every flag it accepts, including `--print`, `--diff`, `--engine`, `-v` and `--log-stdout`; the help and the parser are built from one flag table (#281).
