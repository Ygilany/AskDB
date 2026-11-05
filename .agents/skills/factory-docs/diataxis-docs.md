---
name: diataxis-docs
description: Write, restructure, or audit product documentation with the Diátaxis framework (tutorials, how-to guides, reference, explanation). Use when writing or editing a docs page, when a code change needs matching docs, or when auditing, reorganizing, or revamping a docs site.
---

# Diátaxis docs

Every page is exactly one of four **Diátaxis** types, each serving a different reader need. Classify with the **compass** — two questions about what the reader needs:

| | **Acquisition** — the reader is at *study* | **Application** — the reader is at *work* |
|---|---|---|
| **Action** — informs *doing* | **Tutorial** — a lesson | **How-to guide** — a recipe |
| **Cognition** — informs *knowing* | **Explanation** — a discussion | **Reference** — a dictionary |

Ask the compass of a whole page to type it, and of a single sentence to catch a **leak** — a sentence that belongs to another type. A page that serves two needs serves neither — split it and link the halves. Neighbouring types blur most easily:

- **Tutorial vs how-to** is study vs work, never basic vs advanced. A beginner-level task is a how-to; an advanced lesson is a tutorial.
- **Reference vs explanation**: would someone turn to it *while working*? Then reference. Lists and tables, and anything boring and unmemorable, are reference; anything worth reading away from the product is explanation.

The per-type rules live in [`TYPES.md`](TYPES.md); read the section for every type you write.

## House style

Project-specific preferences — voice, terminology, section names, components, build commands, what needs sign-off — live in the project's **house style**, never in this skill. Find it before writing:

- A style file near the docs: `STYLE.md`, `docs/STYLE.md`, `<docs-app>/STYLE.md`, `CONTRIBUTING.md` docs sections.
- Agent instruction files (`AGENTS.md`, `CLAUDE.md`, `.github/copilot-instructions.md`) — sections about docs.
- Linter config that encodes style: `.vale.ini` + styles, `.markdownlint*`, `cspell` word lists.

House style **overrides** this skill everywhere except the one-type-per-page rule. Where it is silent, use the defaults in `TYPES.md`. If a project has no house style and you are doing more than a one-page edit, offer to create one from [`templates/STYLE.md`](templates/STYLE.md) — fill in what you can observe from the repo and ask only about what you cannot.

## Docs tool

Identify the docs tool, the content root, and where navigation is defined before touching files. [`TOOLS.md`](TOOLS.md) maps common tools (Starlight, Docusaurus, VitePress, MkDocs, Nextra, Mintlify, Sphinx, …) to those locations. Use the tool's native components (callouts, tabs, steps, code groups) in the way existing pages already use them.

## Choose the branch

- **One page** (new page, edit, docs for a code change) → follow the page steps below.
- **Whole site** (audit, reorganize, revamp, "is our documentation good") → follow [`AUDIT.md`](AUDIT.md), which maps the site and then improves it in small, publishable steps.

## Page steps

1. **Load context.** Read the house style, identify the docs tool, and read two or three neighbouring pages to absorb tone and component usage. Done when you can name the house-style files you read (or state there are none) and the nav file you will edit.
2. **Pin the page.** Write down its type (from the compass), its reader, the reader's goal, and what is out of scope. Done when each is one line and the type is exactly one of the four. If the request needs two types, plan two pages.
3. **Gather ground truth.** Read the source for every API name, signature, option, default, flag, error, path, and version the page will state — code, schemas, `--help` output, config files. Done when every factual claim traces to a file or a command you ran. Anything you cannot verify goes to the user as a question, never onto the page.
4. **Outline.** For a new page, a move, or a restructure, propose the outline (headings plus one line each) and wait for approval, unless the house style or the user waives it. For edits to an existing page, proceed.
5. **Write** to the rules for its type in `TYPES.md`, in the house style's voice and terminology. Then reread it sentence by sentence with the compass. Done when every leak is moved to its home page and replaced by a link.
6. **Wire it in.** Add or update the nav entry; link it to its siblings of other types (a tutorial links to the how-tos that come next, a how-to links to the reference it relies on, reference links to the explanation behind it). When moving or renaming a page, add a redirect if the tool supports them and fix every inbound link.
7. **Verify.** Run the docs build (command from the house style, else the package scripts) and any link or prose checkers the project has. Run or type-check code samples where the project makes that practical. Done when the build is green and every sample you could run did run.

Finish by reporting the pages changed, the type of each, and any claims left unverified.
