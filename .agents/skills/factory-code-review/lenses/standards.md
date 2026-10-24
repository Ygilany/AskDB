# Standards lens

Tier: light

**Question:** does the diff follow this repo's documented rules and sound code-shape habits? You match text against rules; you do not redesign.

**Reads:** the profile's *Standards* and *What code review flags* sections, the agent instructions (`AGENTS.md`, `CLAUDE.md`), contributing guide, `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, `.cursor/rules/`, and the diff plus two or three sibling files per changed area.

## Checks

1. **Policy checks.** Every rule under the profile's *Standards* section and the agent instructions that a diff can break and a reviewer can check. Cite the rule (file and section) in each finding. Skip anything tooling already enforces (linter, formatter, type-checker, a CI gate): the profile lists what to leave out.
2. **Conventions of the neighbours.** The change matches the existing pattern in its siblings: naming, file layout, error handling style, test layout. Name the sibling you compared against.
3. **Smell baseline.** The twelve Fowler smells below apply even when the repo documents nothing. Two rules bind them:
   - **The repo overrides.** A documented standard wins; where it endorses something the baseline would flag, suppress the smell.
   - **Always a judgement call.** Label a finding "possible Feature Envy", quote the hunk, and report it as a **nit**. A smell that also breaks a documented standard is a policy finding (check 1), reported at that rule's severity.

   Each smell reads *what it is* → *how to fix*:
   - **Mysterious Name**: a function, variable or type whose name doesn't reveal what it does or holds. → Rename it; if no honest name comes, the design is murky.
   - **Duplicated Code**: the same logic shape appears in more than one hunk or file in the change. → Extract the shared shape, call it from both.
   - **Feature Envy**: a method that reaches into another object's data more than its own. → Move the method onto the data it envies.
   - **Data Clumps**: the same few fields or params keep travelling together. → Bundle them into one type, pass that.
   - **Primitive Obsession**: a primitive or string standing in for a domain concept that deserves its own type. → Give the concept its own small type.
   - **Repeated Switches**: the same `switch` or `if` cascade on the same type recurs across the change. → Replace with polymorphism, or one map both sites share.
   - **Shotgun Surgery**: one logical change forces scattered edits across many files in the diff. → Gather what changes together into one module.
   - **Divergent Change**: one file or module is edited for several unrelated reasons. → Split so each module changes for one reason.
   - **Speculative Generality**: abstraction, parameters or hooks added for needs the spec doesn't have. → Delete it; inline back until a real need shows.
   - **Message Chains**: long `a.b().c().d()` navigation the caller shouldn't depend on. → Hide the walk behind one method on the first object.
   - **Middle Man**: a class or function that mostly just delegates onward. → Cut it, call the real target directly.
   - **Refused Bequest**: a subclass or implementer that ignores or overrides most of what it inherits. → Drop the inheritance, use composition.

   (Smell baseline adapted from Matt Pocock's `code-review`; see `THIRD_PARTY_NOTICES.md` in the skills repository.)

## Severity

- A breach of a documented rule the repo marks mandatory, or one a CI gate would reject: **should fix**; **blocking** only when the profile says so for that rule.
- A breach of a softer documented rule or a sibling convention: **should fix** or **nit** by how much it misleads the next reader.
- A smell with no documented rule behind it: **nit**.

## Does not own

Layer and dependency placement (Architecture), correctness of the logic (Defects), whether a doc is true (Docs), test quality (Tests). When a policy rule is really about one of those, leave it to that lens and say nothing.

Tag: **Standards:**
