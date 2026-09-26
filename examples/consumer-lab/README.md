# AskDB consumer lab

A black-box test bed for AskDB. The lab installs AskDB the way an outside project would: from tarballs packed from a checkout, or later from npm (#244). It drives AskDB only through documented surfaces, and it acts as the host, executing the returned SQL on the shared [multi-engine fixture](../../fixtures/multi-engine/README.md).

- Design: [`docs/specs/consumer-lab.md`](../../docs/specs/consumer-lab.md).
- Work tracked in: #241.

This directory is **not** a member of the AskDB pnpm workspace. It is its own pnpm root with its own lockfile, so it never resolves `workspace:` links.

## Commands

From the repo root:

```bash
pnpm lab:up                    # start and seed the fixture; install the lab if it never was
pnpm lab:use .                 # pack this checkout's publishable packages and install them
pnpm lab:use ../other-checkout # …or another checkout's
pnpm lab ask --db postgres --sql "SELECT agency_id, name FROM org.agency"
pnpm lab:test                  # the lab's own suite (needs the fixture and an installed lab)
pnpm lab:use --restore         # put the committed baseline back
```

`pnpm lab ask` passes the SQL through AskDB's public `ask()`, standing in for a model through the documented `deps.generateText` seam. It then prints:

- the install target;
- the SQL;
- the validation outcome (`ok`, or the error class and rule code, such as `SqlValidationError SQL_NOT_SELECT_OR_WITH`);
- for accepted SQL, the rows.

Rows are read as `fixture_reader`, inside a read-only transaction, with a statement timeout and a 100-row cap. Rejected SQL is never executed. The schema artifact comes from the installed `askdb introspect` and is cached per install target under `.lab/artifacts/`.

For now, `lab ask` supports only Postgres and only `--sql`. The replay model, and the other dialects, arrive in #243.

## How `lab:use` pins the target

1. It packs every publishable package with `scripts/pack-tarballs.sh`, the same step `pnpm smoke:install` uses, into `.lab/tarballs/`.
2. It points the lab's direct AskDB dependencies (`@askdb/core`, `@askdb/client`, `@askdb/config`, `askdb`) at those tarballs.
3. It writes a pnpm `overrides` block into `pnpm-workspace.yaml` covering **every** packed package. Without it, a transitive `@askdb/*` dependency would resolve from npm under the same version number, so the lab would quietly test the published code instead of the checkout.
4. It installs, then reads the lockfile and prints where each `@askdb/*` package resolved from. It fails if any resolved from anywhere but the target's tarballs.

`lab:use` rewrites `package.json`, `pnpm-workspace.yaml` and `pnpm-lock.yaml`. **Don't commit them in that state.** The committed versions are the baseline, and `pnpm lab:use --restore` brings them back.

`askdb` depends on `@askdb/prisma`, whose `@prisma/engines` has a postinstall script that pnpm 11 won't run until it's approved. The lab approves it in `pnpm-workspace.yaml`, as a pnpm user would have to (#259).
