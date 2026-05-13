# Security Policy

AskDB is pre-1.0 software that generates SQL from schema context. It does not execute generated SQL in the current public surfaces. Applications that run generated SQL are responsible for approval workflows, database roles, tenant policy, network controls, and audit logging.

## Reporting a Vulnerability

Please report suspected security issues privately by opening a GitHub security advisory for this repository, if available. If private advisories are unavailable, open a minimal public issue that says you have a security report without including exploit details.

Include:

- Affected package or app.
- Version, commit, or branch.
- Reproduction steps.
- Expected and actual impact.
- Any relevant schema or request shape, with secrets and customer data removed.

Do not include API keys, database credentials, production connection strings, or private schema details in reports.

## Scope

Security-sensitive areas include SQL validation, schema handling, prompt construction, sensitive-field omission, local HTTP surfaces, package publishing, dependency supply chain, and any path that could expose secrets or user data.

## Supported Versions

Until AskDB reaches 1.0, security fixes target the latest public release and `main`.
