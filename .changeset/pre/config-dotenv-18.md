---
"@askdb/config": patch
---

Raise `dotenv` to `^18.0.4`. 17.4.2 (April 2026) was the last 17.x release, and dotenv's fixes now ship on 18.x only. `bootstrapAskDbEnv` loads `.env` files the same way, still quietly. dotenv 18 drops `.env.vault` support, so setting `DOTENV_KEY` no longer makes `bootstrapAskDbEnv` decrypt a `.env.vault` file.
