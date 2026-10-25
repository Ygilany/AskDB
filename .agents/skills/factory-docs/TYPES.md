# Per-type rules

Defaults for each Diátaxis type. The project's house style overrides any of these. Source framework: https://diataxis.fr/.

## Tutorial — a lesson

The reader is at study: they want to acquire skill, not finish a job. You are the teacher and their success is your responsibility — if they get stuck, the tutorial failed.

- **Show the destination first**: "In this tutorial, we will…" — what they will have built, then prerequisites with exact versions. Name the accomplishment, not the learning ("we will build…", never "you will learn…").
- **One concrete path, perfectly reliable.** Pick the example, the data, the versions; eliminate the unexpected. Every promised result must appear, every time.
- **Visible result at every step**, however small, so cause and effect stay connected. Use the tool's steps component if it has one.
- **Keep a narrative of expectations**: "The output should look something like…", "Notice that…", "Remember that…". Point out what the learner would otherwise miss.
- **Speak as "we"**, with unambiguous sequencing: "First, do x. Now, do y."
- **Learning comes from doing.** Explanation is one sentence at the point of need at most, with a link to the explanation page for the rest.
- **Concrete over general.** Lead from step to concrete step; let the pattern emerge from the example rather than stating the abstraction.
- **Ignore options and alternatives.** Stay on the one path; mention a choice only as "you can later…" with a link to the how-to.
- **Permit repetition** — structure steps so the learner can redo them, or do a variation, to reinforce the skill.
- **End on the win**: describe what they built, admiringly, and point to two or three next pages.
- **Run it end to end** from a clean environment before calling it done, and have a real newcomer follow it where you can.

## How-to guide — a recipe

The reader is at work: already competent, with a real goal. Title it "How to …" — "How to deploy behind a reverse proxy" — so the title states both the goal and that the page gives directions.

- **Open with the problem**: "This guide shows you how to…", plus what it assumes. Then steps.
- **Action, and only action.** Leave out teaching and digression; link to reference for the full option list and to explanation for the why.
- **Write from the user's project, not the tool's machinery.** The goal is theirs; the product is the means. Skip what any competent user already knows.
- **Prepare for the real world.** Real situations fork: use conditional imperatives ("If you want x, do y. To achieve w, do z.") and the tool's tabs component for parallel variants.
- **Order steps the way the work flows**, so the reader never has to switch contexts back and forth.
- **Usable beats complete.** Cover the path people need, not every permutation.
- **Include the failure modes** the reader will actually hit, at the step where they hit them.
- **End at the goal**: how to confirm it worked.

## Reference — a dictionary

The reader is at work and needs one fact. They consult it; they do not read it.

- **Mirror the product's structure**: one page per module, command, resource, or config section, ordered the way the code is.
- **Consistent and complete.** Every public item, same fields in the same order: name, signature or syntax, parameters (type, required, default), return or output, errors, limitations, one minimal example. Use lists and tables.
- **Austere, neutral, authoritative.** State facts about the machinery and its behaviour, with no doubt, opinion, or marketing. Warnings about real hazards belong here.
- **Examples illustrate, never instruct.** Link to the how-to or tutorial for usage.
- **Generate from source** where the project can (TypeDoc, OpenAPI, `--help`, JSON Schema) so reference cannot drift; hand-write only what generation cannot express.
- **Coverage is the bar**: every exported symbol, CLI command and flag, config key, endpoint, and error code has an entry.

## Explanation — a discussion

The reader is at study, away from the keyboard, wanting to understand. Explanation is as essential as the other three, not a luxury.

- **Title it so "About" fits in front**: "About query planning", "Why the client never executes SQL". The page talks *about* a subject.
- **Give context**: design decisions, historical reasons, technical constraints — including what the product deliberately does not do. Attribute decisions to their source (ADR, RFC) when one exists.
- **Make connections** to related concepts, even outside the product; analogies help ("An x in system y is like a w in system z. However…").
- **Weigh alternatives and admit perspective**: "Some users prefer w, because z. This can work, but…". Opinion is right here when it is the project's position.
- **Keep it bounded to its question.** Instructions go to a how-to, facts to reference; link to them.
- **Diagrams earn their place here** — architecture, data flow, lifecycles.

## Across all types

- **Lead with the most useful information.** The first paragraph tells the reader whether they are on the right page.
- **Show, then tell.** Real commands, real output, real code — copy-pasteable, with placeholders marked consistently.
- **Link, don't duplicate.** Each fact has one home; everything else links to it.
- **One term per concept** — the house style's term — used consistently across every page.
- **Keep it current.** A page with a wrong claim is worse than no page; when you touch a page, fix the stale claims you notice or report them.
