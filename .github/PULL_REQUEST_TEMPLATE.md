## Summary

<!-- What does this PR do and why? -->

## Checklist

- [ ] Added or updated tests for changed behavior (public APIs, SQL safety, user-facing workflows)
- [ ] Added a changeset for any publishable package change (`pnpm changeset`)
- [ ] Preflight passes: `pnpm smoke:install && pnpm preflight`
- [ ] Does not introduce SQL execution into `@askdb/core` or any public surface — generated SQL is returned to the caller, never run by AskDB
- [ ] No secrets, credentials, or production data committed
