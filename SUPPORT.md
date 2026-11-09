# Support

AskDB is a release candidate for 1.0. The public API of the 12 packages on the 1.0 line is frozen, except the schema artifact format, which can still change before 1.0.0. Studio, `@askdb/enrich` and `@askdb/rag` stay on `0.x`, and their APIs may still change. Changes are documented through changesets and package READMEs.

## Where to go

| You have… | Go to |
| --- | --- |
| A usage, config, or schema/SQL question | [Discussions → Q&A](https://github.com/Ygilany/AskDB/discussions/categories/q-a) |
| A feature idea to propose | [Discussions → Ideas](https://github.com/Ygilany/AskDB/discussions/categories/ideas) |
| Something you built with AskDB | [Discussions → Show and tell](https://github.com/Ygilany/AskDB/discussions/categories/show-and-tell) |
| A reproducible bug | [GitHub issue](https://github.com/Ygilany/AskDB/issues/new/choose) |
| A security problem | [`SECURITY.md`](SECURITY.md) — privately, never in public |

## Bugs (GitHub issues)

Open an issue for:

- Installation problems with a clear reproduction.
- Package or CLI bugs.
- Documentation errors.
- Reproducible SQL generation or validation issues.

Include package versions, Node and pnpm versions, operating system, command output, and a minimal schema fixture when possible. Remove secrets, API keys, customer data, and production database details before posting.

Accepted feature work is tracked as an issue once it has been discussed — please start new feature proposals in Discussions → Ideas so they can be shaped first.

## Security

Report security issues through the process in [`SECURITY.md`](SECURITY.md). Do not include exploit details or private data in public issues or discussions.
