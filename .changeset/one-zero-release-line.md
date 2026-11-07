---
"askdb": major
"@askdb/ai": major
"@askdb/client": major
"@askdb/config": major
"@askdb/core": major
"@askdb/http-api": major
"@askdb/introspect": major
"@askdb/mysql": major
"@askdb/postgres": major
"@askdb/prisma": major
"@askdb/sqlite": major
"@askdb/sqlserver": major
---

**These 12 packages move to the 1.0 release line, and from now on they share one version** (#354). This release is `1.0.0-rc.1` for all of them. `@askdb/ai`, `@askdb/introspect`, `@askdb/prisma` and the four engine packages jump from `0.x` to it. Every later release publishes all 12 at the same version, including a package that didn't change, so one version number names a set that works together. `@askdb/studio`, `@askdb/enrich` and `@askdb/rag` stay on `0.x` (`0.2.0-rc.1` here), because their APIs can still change.

Release candidates publish under npm's `latest` dist-tag, as the betas did, so `npm install askdb` gets the newest one. From `1.0.0` on, a breaking change to any of the 12 is a major release of all 12, except in the experimental Studio and RAG surfaces of `@askdb/config` and the CLI ([ADR 0030](https://github.com/Ygilany/AskDB/blob/main/docs/adrs/0030-1-0-promises-checked-sql-only.md)), which can change in a minor release. `1.0.0-rc.1` freezes their public API (ADR 0030): later release candidates fix bugs, and the upgrade guide lists anything a fix asks your app to change.

**Upgrade notes:** a range written for a `0.x` version doesn't match `1.0.0-rc.1`. For example, with `"@askdb/ai": "^0.1.0-beta.9"`, `npm update` stops at the newest `0.1.0-beta.*` and never installs `1.0.0-rc.1`. Install each AskDB package your app lists at `@latest` in one step, as the upgrade guide's 1.0.0-rc.1 section shows.
