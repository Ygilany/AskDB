# Security triage

How to sort a report that might be a security issue: a **vulnerability** gets a GitHub security advisory, and a **hardening bug** is a public issue labelled `security-hardening`. The rule is [ADR 0046](../adrs/0046-a-vulnerability-is-a-break-in-something-askdb-owns.md); `SECURITY.md` ("Reporting a Vulnerability", "Scope") states it for reporters.

## Vulnerability or hardening bug

Sort a report by what broke:

- **AskDB broke something it owns: a vulnerability.** Code execution (GHSA-qqx9-qpw2-wcqg, schema front-matter); tenant-scope validation, or tenant IDs AskDB binds or inlines wrongly (GHSA-wjgj-mf9h-6g68, `sql-only` mode); leaked secrets; access control on AskDB's local servers (the HTTP API, and Studio including Studio execute: its session token and its `Host` and `Origin` checks); package publishing and the dependency supply chain. The host's database controls don't change this: an ID-binding defect gets an advisory even where row-level security would stop the leak.
- **A SQL check missed something: a hardening bug.** Any SQL that gets past the read-only check, the tenant check or the sensitive check, including a check that reads a string, a name or a comment differently from the engine. This holds when the miss would let a tenant-scoped query read another tenant's rows: database-level tenant enforcement is the boundary that stops it.
- **Neither, and the harm comes only from a host that skipped a control in `SECURITY.md`'s "What integrators should do"** (a read-only, least-privilege role, database-level tenant enforcement, trusted schema sources, `allowSchemaOverride` off for untrusted callers): **not a vulnerability.**
- **Unsure: treat it as a vulnerability** until the maintainer has triaged it.

## When you find one

- **A vulnerability, or unsure:** keep it private. Leave it out of public issues, PRs, commit messages and comments, and bring it to the maintainer as a decision (`docs/agents/project-board.md`). Opening and publishing an advisory is the maintainer's.
- **A hardening bug:** open a public issue labelled `security-hardening` and fix it in an ordinary PR with an ordinary changeset. The GitHub Release lists the fix under "Security hardening", apart from "Security", which lists advisories (`docs/release.md`, Publish Flow step 7).

## Reports from outside

Private vulnerability reporting is the front door for every report, check misses included. Within 7 days of a report, the maintainers either open an advisory, or move it to a public issue labelled `security-hardening` and tell the reporter. Moving a private report into the open is the maintainer's call: recommend a side, naming the bullet under "Vulnerability or hardening bug" it falls under.

## Published advisories

The 12 advisories published before 2026-11-11 keep their text and severity, including the 10 tenant-check misses published under the earlier rule. Leave them, and the docs paragraphs that cite them, as written.
