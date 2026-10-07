# ADR 0015 — Published dependency ranges move only on purpose

## Status

Accepted (2026-09-30, maintainer decision on #403). Amended 2026-10 (only peer ranges are held; see Amendments). Implemented in `.github/dependabot.yml`, the published packages' `ai` ranges, and the consumer lab's `host-peers` scenario (`examples/consumer-lab/test/host-peers.test.ts`).

## Context

A published package's ranges are what a host installs against. AskDB's AI packages declare `ai` as a peer, and `reference/packages.mdx` tells hosts to depend on `ai` directly to pin its version.

Dependabot's weekly grouped version update ade3c1a1 (merged in #274) rewrote the published ranges along with the workspace's lockfile. In `askdb@1.0.0-beta.43` it raised the `ai` floor of every published package from `^7.0.51` to `^7.0.113`, and `@askdb/rag`'s `@ai-sdk/openai` peer from `^4.0.29` to `^4.0.74`. AskDB needed nothing newer, and no advisory covered the older versions. A host pinned below the new floor can't install the release with npm (`ERESOLVE`); with pnpm it gets unmet-peer warnings, and AskDB runs on a second AI SDK instead of the host's. The next grouped update, #402, would have raised the floor again, to `^7.0.122`.

## Options considered

### A. Let floors follow every bump (the default before this decision)

Rejected. Each routine bump becomes a breaking install change for npm hosts on an older version. It ships as a dependency bump, with nothing in AskDB that needs it.

### B. Floors move only on purpose (chosen)

A floor sits at the lowest version AskDB needs and rises only for a reason a changeset can name.

## Decision

- A bump that a range already allows moves only the lockfile. Dependabot runs `versioning-strategy: increase-if-necessary`, which GitHub applies to version and security updates alike.
- A floor rises by hand, to the first version that has what AskDB needs: a feature or fix it depends on, or a security fix. The changeset names the reason.
- The consumer lab's host pins `ai` and `@ai-sdk/openai` at the floors. Its `host-peers` scenario fails when an installed AskDB package declares a peer range those pins don't meet, or when AskDB's packages declare different `ai` ranges (a runtime `ai` floor raised alone, which gives AskDB its own `ai` without a peer warning), so a change that raises a floor on purpose raises the lab's pin with it. Dependabot updates the lab through an entry of its own (`directory: /examples/consumer-lab`), which updates the lab's lockfile with its pins and ignores the AskDB packages (the baseline refresh moves them) and the two floor pins. The root entry's version updates skip the lab (`exclude-paths`), since that entry bumped the lab's manifest without its lockfile (#402).

## Consequences

- The `ai` ranges (peer, dev and runtime dependency) go back to `^7.0.51`, and `@askdb/rag`'s `@ai-sdk/openai` to `^4.0.29`. Lowering a floor widens the range, so no host breaks.
- The floor is checked at runtime, through the lab, and not by compiling AskDB against it. The workspace builds against its lockfile's newest `ai`. AskDB's adapters don't compile against `ai@7.0.51`: their `@ai-sdk/*` packages pin a newer `@ai-sdk/provider` than that `ai` does, so the two provider types don't match. Their published types expose only `AiProviderAdapter`, so a host never sees the mismatch. On `lab:use .`, every AskDB package resolves the host's `ai@7.0.51`, and the matrix passes. The lab drives `@askdb/core`, `@askdb/client` and `@askdb/ai-openai`. At the floor (`ai@7.0.51`, with `@askdb/rag` on `@ai-sdk/openai@4.0.29`), the AI packages' and `@askdb/core`'s unit tests pass too, but they only construct the other adapters' models without calling them, and `@askdb/rag`'s embedder tests mock `ai`.
- The same bump raised plain runtime-dependency ranges too: the adapters' `@ai-sdk/*`, `@askdb/core`'s `zod`, `askdb`'s `@inquirer/prompts`, `@askdb/prisma`'s `@prisma/internals`. They stay where they are. AskDB doesn't ask the host to provide those, and package managers install the newest match anyway, so lowering them would change nothing a host installs. They follow this decision from here on.
- `exclude-paths` doesn't cover security updates (dependabot-core#14408), so a root security update can still bump a lab pin, a floor pin included, without the lab's lockfile. CI's `consumer-lab` job first checks that the lab's lockfile matches its manifest (`pnpm install --frozen-lockfile --lockfile-only`) and fails such a pull request: revert its change to the lab's `package.json`, and let the lab's own entry propose the lab's bumps.
- The lab entry's `ignore` applies to security updates too, so that entry never moves a floor pin. An advisory against the floor version still raises a Dependabot alert on the lab's lockfile, the one install of that version in the repository: that alert is the signal to raise the floor.
- Until a release ships the restored floors, `host-peers` fails on the published baseline (`npm:latest`, `askdb@1.0.0-beta.43`); on `lab:use .` it passes.

## Amendments

**2026-10 — One `ai` range per AI SDK major (#196):** ADR 0006's 2026-09 amendment makes `ai` a peer of `@askdb/core` and `@askdb/rag` with the range `^6.0.0 || ^7.0.51`, so hosts on AI SDK 6 can use the BYO-model path. `@askdb/ai`, `@askdb/client`, the shims and the apps stay on `^7.0.51`. The rule "every AskDB package declares the same `ai` range" now reads "the same `ai` range for the host's AI SDK major": `host-peers` compares the alternative of each range that covers the lab's pinned major (`^7.0.51` from `^6.0.0 || ^7.0.51`). It still fails when a runtime range rises alone (checked by raising `askdb`'s `ai` to `^7.0.113` in an installed lab). `host-peers` reads only the 7.x part of a range, and the lab's host is on AI SDK 7, so the lab doesn't hold the AI SDK 6 floor (`ai@6.0.0` with `@ai-sdk/openai@3.0.0`). The installable smoke holds it instead, the way the lab holds the 7 floor. Its `consumer-ai6` fixture pins exactly those versions, installs without `--legacy-peer-deps`, type-checks with the packed declarations included (`skipLibCheck: false`), and runs `ask()` and the RAG embedder. If core or rag starts using something newer than 6.0.0, `pnpm smoke:install` fails. A deliberate rise of the 6 floor moves the fixture's pins with it.

**2026-10 — Only peer ranges are held (#470):** The maintainer narrowed this decision to peer ranges. A package's own dependencies, runtime and dev, may move to the latest version with any routine update: the host doesn't provide them, so a raised floor never stops a host's install. This replaces the Consequences line that held plain runtime-dependency ranges (`@ai-sdk/*` in the adapters, `zod`, `@inquirer/prompts`, `@prisma/internals`). Peer ranges keep the rules above: the floor is the lowest version AskDB needs (and has no known advisory), it rises only on purpose with a changeset that names the reason, and every major the upstream project still supports stays accepted. AI SDK 6 still ships releases (`ai-v6` dist-tag), so `@askdb/core` and `@askdb/rag` keep `ai` at `^6.0.0 || ^7.0.51`. One runtime range stays held with the peers for now: the apps' `ai` (`askdb`, `@askdb/http-api`, `@askdb/studio`). `host-peers` requires every AskDB package to declare one `ai` range per major, because an app's `ai` raised alone installs a second AI SDK next to the host's with no peer warning. Letting it follow the latest means changing that check. The dependency refresh `1f212ac2` (#467) raised the peer floors too; #471 restores those and keeps its own-dependency bumps.
