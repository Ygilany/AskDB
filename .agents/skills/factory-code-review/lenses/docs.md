# Docs lens

Tier: light

**Question:** does what is written down still match the code, and is everything that should be written down written? You read; you never edit. Larger docs work goes out as a handoff finding for the implementer.

**Reads:** documentation, READMEs, examples, code comments and the changelog that the diff touches or that describe behaviour the diff alters; the profile's *Docs* section (where user-facing docs live and what must change with the code, the changelog or changeset rule, house style), the *Decision records* subsection of its *Architecture* section (where records live, what needs one), and *What code review flags*.

**Scope, to keep it cheap.** Read pages the diff touches, pages that mention a changed symbol, flag, key or default (`grep` for the old and new names), and the doc sections the profile names. Never read the whole docs site.

**Sibling skill.** When `diataxis-docs` is installed beside this skill, read its `TYPES.md` (read-only) to name the Diátaxis type each missing or wrong page needs, and the repo's house style file (`STYLE.md` or what the profile names) for voice and terminology. Without it, check truthfulness only and do not name types.

## Checks

1. **Docs vs code.** Docs, READMEs, examples and code comments touched by the change, or describing behaviour it alters, match the new behaviour. Grep for the old names and defaults the change replaced. A documented command that fails as written (wrong working directory, missing flag or file) is a finding.
2. **Docs that should exist.** First list every user-facing addition or change in the diff, one line each (CLI flag, config key, exported symbol, default, error text, endpoint), including ones the spec or description never mention. Then check each against the docs. A user-facing change (public API, CLI flag, config key, default, error text, integration pattern) updates the user-facing docs in the same PR, wherever the profile says those live. The reference docs list every new public export. A changelog or changeset entry exists where the repo requires one.
3. **Decision records.** A change that settles a choice between viable designs (two or more options that would each have been clean) has a record where the profile says, with the options and why the losers lost, and its row in the index. (Whether the change *contradicts* a record is Architecture's.)
4. **Comments.** A comment that states something the code no longer does, or restates the code line by line.
5. **Stale siblings.** The same document or a sibling doc left stale by the change.

## How to report

Each finding names the page (or the page that should exist), the Diátaxis type when known, and the change in one or two sentences. When the whole fix is a sentence inside the anchored lines, give a suggestion block ([report format](../references/report.md)). A new page or a restructure is a handoff: say what to write and where, not the text.

## Severity

- A documented command or contract that is wrong in a way that misleads a user into failure; a required changelog entry missing: **should fix**, **blocking** when the profile says the doc is part of the contract.
- A stale sentence, a missing reference entry, a missing decision record: **should fix**.
- A comment that restates code, wording: **nit**.

## Does not own

PR-description claims (Spec), any claim where the code is wrong and the doc is right (Defects), and the bump level a breaking change needs (Architecture).

Tag: **Docs:**
