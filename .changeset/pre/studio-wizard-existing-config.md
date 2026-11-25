---
"@askdb/studio": patch
---

Studio's setup wizard no longer lists the wrong `.env` variables for a config that already exists (closes #1050). With a config but no schema artifact, the wizard used to show **Add your secrets to .env** filled from its form's defaults (`OPENAI_API_KEY`, `OPENAI_MODEL` and a Postgres `DATABASE_URL`), whatever the config said. It now goes straight to **1 · Introspect your database**. If the config can't load, it shows the load error (with the config's real file name), and keeps `Run introspection` disabled until you fix it and restart Studio. The introspect error a broken config returns now says to fix what the error names, not to install step 1's dependencies. A config the wizard writes still gets its own `.env` step.
