# Defects lens

Tier: deep

**Question:** what input or state makes this code do the wrong thing, or the unsafe thing? You read the diff the way an attacker and an unlucky user would. Correctness and security are one lens because they take the same mindset: assume the author's intent is irrelevant and try to break it.

**Reads:** the diff, the changed files in full, their callers and callees, the existing tests for the module, the profile's *Defects* section (sensitive areas, checklists), *What code review flags*, *Verification commands* and *Guardrails*.

A candidate is a **defect**: a specific input or state, and the wrong result, crash, hang, leak or misled reader it produces. Name the input; a check with no nameable input is sound or n/a, not a finding. Any line in the diff is in scope, moved lines included; code outside the diff counts when the change makes it reachable or contradicts it.

## Sensitive areas

Match each changed path against every row of the profile's *Sensitive areas* table, and apply what all its matching rows name: each checklist in full, marking every item pass, finding or n/a, and the security pass below where any row says "security review". With no profile, treat auth, permissions, crypto, secrets, parsing, escaping, validation, query building, file-system and network access as sensitive, and run the security pass on them.

**Security pass.** You run it yourself, as part of this lens; the host's built-in security review (for example `/security-review`) starts agents of its own, so it stays with the user, to run beside this review. Over the changed code in the area, mark every item pass, finding or n/a:

- **Injection.** Untrusted input reaching a query, shell command, path, URL, template, regex or deserialiser gets the escaping or parameterisation that sink needs.
- **Access.** Every new entry point checks who is calling, and every data access is scoped to what that caller may see.
- **Secrets.** Credentials, tokens and personal data stay out of logs, error messages, responses, URLs and written artifacts.
- **File system and network.** Paths resolve inside their intended root, symlinks included; outbound requests to caller-supplied hosts are restricted.
- **Crypto and randomness.** Tokens and IDs that must be unguessable come from a cryptographic source; secrets compare in constant time; no home-made crypto.
- **Supply chain and CI.** New dependencies, install scripts, workflow triggers and token permissions grant no more than the change needs.

## Checks

1. **Edge inputs silently accepted.** A blank, `null`, out-of-range, duplicate or oddly cased value passes validation and falls through to different behaviour instead of an error: `null` treated as absent, a blank field replaced by a default, two labels normalising to one key, a non-injective ID format.
   - **Silent discard.** Every user-supplied setting, flag, option or config key either takes effect or produces an error or warning. Find the ones that vanish: misplaced (right key, wrong section), duplicated (which one wins, and is the loser reported?), owned by a different module than the one reading it, unknown or misspelled; values dropped on save, load or round-trip; options a type accepts but the code never reads. Trace each new or changed option from where the user sets it to where it takes effect.
   - **Adversarial variants.** For parsers, escaping, quoting, validation and string-vs-rule matching, try what the author did not imagine: encodings and normalisation (Unicode lookalikes, case folding, percent- or entity-encoding, null bytes); quoting and escaping variants, comments, nested or unterminated tokens; dialect and platform differences; partial configs where "unset", empty, `null` and default mean different things. Write the concrete input and trace it through the code, or run it through an existing test harness.
2. **Gate bypasses and failure direction.** A safety check (validator, permission or scope check, CI gate, origin check) that a crafted input slips past.
   - **Threat model.** Name who the gate stops. A gate on a **trust boundary** (untrusted input, security, data safety) is hunted adversarially. A gate that catches honest mistakes by people who already have commit access (a lint, a CI convention check) is hunted by honest edits: a bypass that needs deliberate evasion is a **nit**, and the one ordinary edit that slips past is a finding by its reachability. A limit the diff documents (a blind-spot list, an ADR, a comment) is not a finding unless the documentation misstates it or an honest edit reaches it.
   - Guards (auth, permissions, validation, sanitising, allow and deny lists) **fail closed**: an input the code cannot classify is rejected. On a trust boundary, a **fail-open** path is a finding even when no known input reaches it today: a default branch that allows, a `catch` that returns success, a parse error treated as "no restriction". Name the input that takes the unsafe path, or state why none can.
   - **Reused code, new meaning.** When the change calls existing code in a new role (a display helper now used for security, a lenient parser now guarding input), review that code as if it were new. Its old tests prove the old contract. Cite it as `pre-existing: path:line` and anchor the comment on the changed call site.
3. **Lifecycle and failure paths.** Processes, sockets or timers that outlive shutdown or a timeout; races between concurrent runs; a lock taken after the work it guards; a failure path that exits before rollback or cleanup; a retry that repeats a non-idempotent side effect. For each resource the change acquires (process, handle, lock, temp file, transaction, subscription), find where it is released on the success path and on every error and timeout path.
4. **Claims in the code vs the code.** A doc comment, error message or name that says one thing while the code does another, where the code is the part that is wrong. (When the claim is wrong and the code is right, that is Docs.)

## Verify

From the profile's *Verification commands*, run those relevant to the changed paths and allowed by *Guardrails*; CI results at the head SHA (`gh pr checks <n>`) may stand in for a command CI runs. Run a cheap experiment whenever it settles a doubt, in a scratch directory.

## Severity

- A security or correctness defect reachable by some input today, or a trust-boundary gate a crafted input bypasses: **blocking**.
- A real defect with lower impact (misuse that fails loudly or rarely, a misleading contract), or a defect with no reachable input today: **should fix**, unless a *Sensitive areas* row matching that path marks it "latent defects block".
- Behaviour that is odd but has no wrong result: not a finding.

## Does not own

Rule and convention breaches (Standards), where code lives (Architecture), whether tests prove a fix (Tests), stale docs (Docs).

Tag: **Security:** for a security finding, **Correctness:** for the rest.
