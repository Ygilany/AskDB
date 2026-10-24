# Architecture lens

Tier: deep

**Question:** is each changed behaviour built in the place that owns it? "Who owns this concept?" is the question behind every check here.

**Reads:** the profile's *Architecture* section (layer map, dependency direction, public surface, versioning rule, decision records) and *What code review flags*, the architecture docs and decision records it points at, package manifests, and the diff. For vocabulary, read the sibling `codebase-design` skill's `SKILL.md` when it is installed (module, interface, seam, depth, leverage); otherwise use those words in their plain sense.

**No layer map?** Infer layers from architecture docs, directory structure and package manifests. Label every finding that rests on an inferred rule "inferred", cap it at **should fix**, and emit a *Proposed profile addition* for the *Architecture* section (the layers and direction you inferred, paste-ready).

## Checks

1. **Right layer.** Each changed behaviour sits in the layer that owns its concept. A fix in a caller for a defect in a callee, a host concern pushed into a library, vendor-specific code in a generic layer: each is a finding even when the code is correct. Name the layer the code should live in and cite the rule or doc that says so.
2. **Dependency direction.** New imports and dependencies point the allowed way. A lower layer importing a higher one, or a new cycle, is a finding.
3. **Sibling duplication.** The same logic added to two or more sibling modules (one per engine, provider or platform) belongs in the shared layer they already depend on.
4. **Public surface and breaking changes.** Every type named in an exported signature is itself exported from the package entry point. Breaking changes (removed or renamed exports, changed defaults, narrowed inputs, new required options) carry the bump the profile's versioning rule requires. New public surface is the smallest that serves the stated need: a symbol exported only so a test can reach it is a finding.
5. **Decision records.** Read the decision index (or the ADR directory) for records touching the changed paths. A change that contradicts an accepted record is a finding that cites the record.
6. **Denylist over an open input space.** A check that recognises forbidden forms of an input with an unbounded grammar (source syntax, URLs, SQL, paths) by listing them has no fixed point: each fix adds a form to chase, and the next reviewer finds another. Name the alternative (an allowlist of the plain forms, or a run-time check) and raise it in the first review of the change; later rounds read it in the prior findings. **Should fix**.
7. **Module shape** (with the `codebase-design` vocabulary): a shallow module whose interface is nearly as complex as its implementation, a seam placed where nothing varies, an adapter with one caller. Report as **nit** unless the repo's documents make it a rule.

## Severity

- A violation of a documented layer rule or an accepted decision record: **blocking** when it breaks a boundary the repo says must hold, else **should fix**.
- An inferred-layer finding: **should fix** at most, labelled "inferred".
- Module-shape observations: **nit**.

## Does not own

Whether a missing decision record should exist, whether reference docs list a new export, or whether a changelog or changeset entry exists at all (Docs). Whether the code is correct (Defects).

Tag: **Architecture:**
