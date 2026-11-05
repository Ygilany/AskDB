# Spec: apply the ai test-campaign plan (#511)

## For the owner

This spec applies the `ai` test campaign's plan to five test files in `@askdb/ai`: two tests repaired so they can fail for what their names promise, nine duplicate tests folded into named keepers, and three tests that can't fail deleted. The three contract-file rows are deferred. No production code changes.

| Decision | Answer | Settled by | Undo |
| --- | --- | --- | --- |
| 1. Which rows this ticket applies | Every F, C and D row except the three contract-file consolidations (`anthropic.contract.test.ts` "sends no thinking block…", `openai.contract.test.ts` "sends reasoning.effort for o-series…" and "does not send reasoning for gpt-5 -chat variants"), which stay as they are and are named in the PR body | Triage, which the issue body (filed by the factory's campaign) left to decide; triage comment, Summary and Out of scope | Two-way: revert the PR |
| 2. What each applied row does | Repair 2 (F), fold 9 (C) with the plan's carry-over assertions, delete 3 (D), as the issue's ledger rows and the triage Agent Brief say | The campaign plan in the issue body, confirmed at triage with no open decisions | Two-way |
| 3. The optional `["gpt-5.1-chat", false]` row in `openai.test.ts` | Not added; the scope stays at five files | Triage Agent Brief ("skip it unless the diff has room") | Two-way |
| 4. Test-only production seams | None to remove; no production file changes | Campaign plan ("Test-only production seams unlocked: none"); triage acceptance criteria | Two-way |
| 5. Changeset | None: tests only, nothing published changes | Triage, Out of scope | Two-way |
| 6. The three "possible product bugs" in the issue body | Out of scope; not fixed or filed here | Triage, What verification found | Two-way |

```text
provider.test.ts     "maps an alias to its owning package…"            ──fold──▶  "names every built-in provider…" + foundry alias row
                     "keyMissingMessage … registration order"           ──repair── [three toContain → one exact toBe]
registry.test.ts     "lists the built-ins in display order"             ──fold──▶  "derives setup-wizard defaults…, in table order"
                     "names an @ai-sdk peer for every provider…"        ──fold──▶  same keeper (asserts every peerPackage)
                     "finds rows by name or alias, case-insensitively"  ──fold──▶  "registers a built-in by alias…"  [input "Foundry" → " Foundry "]
                     "still accepts custom adapter objects unchanged"   ──fold──▶  provider.test.ts adapter-object registration + "mixes built-in names…"
                     "builds a model lazily from the installed peer SDK" ─repair── [renamed "builds a built-in's model from its installed peer SDK"]
azure.test.ts        "throws without resourceName or baseURL"           ──fold──▶  "names the askdb.config keys…"  [regex gains "Azure provider requires"]
                     "maps reasoningEffort for gpt-5.x deployments"     ──fold──▶  o-series deployment test + openai.test.ts table
                     "uses providerOptions.modelFamily…"                ──fold──▶  it.each row ["gpt-5", true]
                     it.each "model family %s → reasoning: %s" 12 rows  ──trim──▶  ["gpt-5", true], ["gpt-4o", false]
anthropic.test.ts    "returns undefined when no API key is configured"  ──delete── proof stays in resolveBaseConfig block
                     "has a configHint that references…"                ──delete── proof stays in "keeps each row consistent with its adapter"
optional-peer.test   "passes the loaded module through…"                ──delete── proof stays in every contract test importing a real SDK
deferred             anthropic.contract ×1, openai.contract ×2          ── untouched, named in the PR body
```

**Risks:** a removed test could hold an input its keeper lacks; the ledger checked each pair and the spec names every keeper below. `packages/ai/src/providers/**` is a sensitive path, which is why the quick-lane build's tripwire moved this ticket to the standard lane; the scope is unchanged by that move.

**Done when:** the 14 applied rows are in place as above, the repaired order test fails when the hints are joined in another order, the three deferred rows are untouched and named in the PR body, no production file changes, and `pnpm test`, `pnpm lint` and `pnpm test:ai-floors` pass.

**Needs you:** nothing open.

Reply `approve`, or `/changes` with what to change.

## Problem Statement

The `@askdb/ai` tests (the provider registry and the five built-in providers) carry redundancy and two tests that promise more than they check. Several tests replay a case a keeper already proves: inventory checks of the built-in table that its setups test already pins, a private-lookup test whose cases the registry's alias tests cover, a custom-adapter test that duplicates one in `provider.test.ts`, and an Azure table that re-tables OpenAI's reasoning classification. Three tests can't fail at all. The registration-order test passes in any order, and the "lazily" test asserts nothing about laziness. A maintainer reading a failure, or deciding whether a change is covered, has to wade through tests that add no signal, and two tests give false confidence.

## Solution

Apply the campaign's ledger rows, narrowed at triage, so the same contracts stay proven with fewer and sharper tests. Each folded or deleted test has a named keeper that still passes; the two weak tests are made to check what their names say (or renamed to say what they check). The three contract-file consolidations are left for a later campaign. Only test files change.

## User Stories

1. As an AskDB maintainer, I want the registration-order test to assert the exact assembled key-missing message, so that a change to the join order of adapter hints fails it.
2. As an AskDB maintainer, I want the peer-SDK model test named for what it checks, so that its name doesn't claim laziness it never asserts.
3. As an AskDB maintainer, I want the built-in table's order and peer packages asserted once, in the setups test, so that a table change fails one test, not three.
4. As an AskDB maintainer, I want the alias-registration test to pass a padded, mixed-case name (`" Foundry "`), so that trimming and case-folding stay proven after the private-lookup test goes.
5. As an AskDB maintainer, I want the custom-adapter registration contract proven in one place, so that its duplicate in `registry.test.ts` no longer adds noise.
6. As an AskDB maintainer, I want the registry-surfaced missing-provider message proven by the existing "names every built-in provider…" test and its alias rows, so that the alias-owner test that replays the same path can go.
7. As an AskDB maintainer, I want Azure's tests to cover only Azure's own logic (deployment name, or the `modelFamily` override when set), so that OpenAI's reasoning classification is tabled once, in `openai.test.ts`.
8. As an AskDB maintainer, I want the Azure missing-resource test to be one test asserting the whole message (`Azure provider requires`, both config keys and the env var), so that the weaker duplicate goes without losing any assertion.
9. As an AskDB maintainer, I want tests that can't fail (Anthropic's provider-local replay of the no-key case, its duplicate config-hint check, and the optional-peer pass-through that only exercises Promise semantics) deleted, so that the suite's count reflects what it proves.
10. As an AskDB maintainer, I want the three deferred contract-file rows named in the PR body, so that a later campaign or follow-up can pick them up.
11. As an AskDB maintainer, I want `pnpm test:ai-floors` to keep passing, so that the floor-SDK contract runs are unaffected by the cleanup.
12. As an AskDB user, I want no production behaviour to change, so that this cleanup carries no risk to the package I install.
13. As a reviewer, I want each removed test mapped to its keeper in the PR, so that I can check nothing lost coverage.

## Implementation Decisions

- Only test files under `packages/ai/src` change: `provider.test.ts`, `registry.test.ts`, `providers/anthropic.test.ts`, `providers/azure.test.ts` and `providers/optional-peer.test.ts`. No production module, export or seam changes.
- **Repairs (F).** The key-missing order test asserts the exact message `test context: no AI API key configured. For OpenAI, set OPENAI_API_KEY. For Google, set GOOGLE_API_KEY.` with an exact equality, in place of three substring checks; the registry joins hints in registration order, so this pins order. The peer-SDK model test keeps its body and is renamed "builds a built-in's model from its installed peer SDK".
- **Folds (C), with carry-overs.** In `provider.test.ts`, the alias-owner test goes; its keepers are the "names every built-in provider…" test and the `foundry` alias row. In `registry.test.ts`, the display-order, peer-package, find-by-name and custom-adapter tests go; the alias-registration test's input becomes `" Foundry "` to keep the trim and case proof; imports left unused by the removals go with them. In `azure.test.ts`, "throws without resourceName or baseURL" is merged into "names the askdb.config keys…", whose regex gains `Azure provider requires` at its start; the `gpt-5.x` effort test and the `modelFamily` detection test go; the `it.each` table keeps only `["gpt-5", true]` and `["gpt-4o", false]`.
- **Deletes (D).** Anthropic's "returns undefined when no API key is configured" and "has a configHint that references the askdb.config path", and optional-peer's "passes the loaded module through when the peer is installed". Their remaining proofs: the `resolveBaseConfig` block in `provider.test.ts` (and its registry-level no-key case), the "keeps each row consistent with its adapter" test in `registry.test.ts`, and every contract test that imports a real SDK.
- **Deferred.** The three contract-file consolidations are not applied; the PR body names them.
- **No changeset**: the change touches no published output.

## Testing Decisions

- A good test here proves a public or cross-module contract (the registry's messages, a provider's config resolution and option mapping, the wire shape) through the package's own entry points, and fails for the regression its name names. A test that replays a keeper's case, or can't fail for any implementation, is removed.
- The seams are the existing test files and their entry points (`createAiRegistry`, each provider adapter's `resolveConfig` and `resolveProviderOptions`, `rethrowMissingPeer`); no new seam is added.
- Proof the change holds: the package's suite stays green under `pnpm test`; the repaired order test is checked to fail when its expected hint order is swapped (or the registration order is reversed) and to pass as written; `pnpm lint` passes; `pnpm test:ai-floors` passes, since the contract files are untouched.
- Prior art: the sibling campaign specs (#508, #509, #512, #513, #518) apply their plans the same way, test files only, keeper named per removed test.

## Ticket coverage

| "Done when" item (triage Agent Brief, narrowing the issue's acceptance criteria) | Met by |
| --- | --- |
| `provider.test.ts`: the alias-owner test removed (proof stays in the missing-provider test and the `foundry` row); "keyMissingMessage … registration order" uses an exact `toBe` | Implementation Decisions, Repairs and Folds; decision 2 |
| `registry.test.ts`: the four C tests removed; the `"Foundry"` input becomes `" Foundry "`; the F test renamed | Implementation Decisions, Repairs and Folds; decision 2 |
| `providers/anthropic.test.ts`: the two D tests removed | Implementation Decisions, Deletes; decision 2 |
| `providers/azure.test.ts`: the missing-resource test merged (regex gains `Azure provider requires`); the `gpt-5.x` and `modelFamily` tests removed; the `it.each` table trimmed to two rows; the optional `openai.test.ts` row skipped unless the diff has room | Implementation Decisions, Folds; decisions 2 and 3 |
| `providers/optional-peer.test.ts`: the pass-through test removed | Implementation Decisions, Deletes; decision 2 |
| `pnpm test` green for the package, `pnpm lint` passes, `pnpm test:ai-floors` still passes | Testing Decisions, proof the change holds |
| The PR body names the three deferred contract-file rows | Implementation Decisions, Deferred; decision 1 |
| (Issue) each D row's named proof still exists and passes | Implementation Decisions, Deletes |
| (Issue) each test-only production seam the plan unlocks is removed (none) | Implementation Decisions, first bullet; decision 4 |

## Out of Scope

- The three contract-file consolidations: `anthropic.contract.test.ts` "sends no thinking block for models without extended thinking" and `openai.contract.test.ts` "sends reasoning.effort for o-series models" and "does not send reasoning for gpt-5 -chat variants" (decision 1).
- Adding `["gpt-5.1-chat", false]` to the `openai.test.ts` table (decision 3); `gpt-5.1-chat-latest` already covers the same branch there.
- Any production code, including the issue body's three possible product bugs (gateway `splitModelId` ordering, untrimmed Azure env reads, the Gemini 3 effort clamp); each would need reproducing and its own issue (decision 6).
- A changeset (decision 5).

## Further Notes

- The quick-lane build already ran on this branch: commit `1ea50f78` and draft PR #524 apply exactly these 14 rows (5 files, about 104 changed lines). Its tripwire fired on the sensitive path `packages/ai/src/providers/**`, not on size, so the ticket moved to the standard lane with its scope as triage settled it. The standard-lane build checks that commit against this spec and adds what the spec asks that it lacks, such as the order test's fail check.
- The rows cite tests by name; the line numbers in the issue are from head `2ff9332c` and shift as tests are removed.
