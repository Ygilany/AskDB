## Summary

<!-- What does this PR do and why? -->

## Checklist

- [ ] Added or updated tests for changed behavior (public APIs, SQL safety, user-facing workflows)
- [ ] Integration, driver, and env-dependent suites are gated with `integrationSuite()`
- [ ] Types named in new or changed exported signatures are re-exported from the package entry point
- [ ] Added a changeset for any publishable package change (`pnpm changeset`)
- [ ] Preflight passes: `pnpm smoke:install && pnpm preflight`
- [ ] Does not introduce SQL execution into `@askdb/core` or any public surface — generated SQL is returned to the caller, never run by AskDB
- [ ] No secrets, credentials, or production data committed
- [ ] Independent review done by an agent or person who did not write the change (`pr-review` skill, `docs/agents/pr-review.md`): <link>
- [ ] Description re-verified against the final diff after the last push
