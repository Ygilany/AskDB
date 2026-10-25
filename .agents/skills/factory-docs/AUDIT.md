# Site audit and improvement

The whole-site branch. Diátaxis changes a site from the inside, one small improvement at a time: this branch builds a **map** of where the site stands, then works through it in small steps, each published as soon as it is done. The map guides the steps; it is not a blueprint to complete before anything ships.

- **Improve what is there.** Keep existing pages and rework them; rewrite from scratch only a page that cannot be saved.
- **Structure follows content.** Create a nav section only when there is a page to put in it; let the four-way structure emerge as pages are fixed.
- **Every step leaves the site better, building, and publishable.**

## 1. Load context

Read the house style, identify the docs tool and nav file (`TOOLS.md`), and read the project's own statement of what the product is and who uses it (README, mission or architecture docs). Done when you can state in two lines who the readers are and what they come to do.

## 2. Inventory every page

For each page in the content root, record: path, title, nav location, Diátaxis type(s) it currently serves (by the compass), intended reader, and problems — leaks between types, stale claims, broken links, orphaned from nav, duplicate of another page. Done when every file under the content root has a row — count the files and match the count.

Spot-check factual claims against the source while you read; record each mismatch with the file and line that disproves it.

## 3. Map the product surface

Enumerate what users can touch, from the source rather than the docs: packages or modules and their exports, CLI commands and flags, config keys, HTTP endpoints, error codes, integrations, deployment targets. Then map each item to the reference page that covers it. Done when every item is marked covered, partial, or missing.

## 4. Assess quality and gaps

Two kinds of quality, judged separately:

- **Functional quality** — accurate, complete, consistent, precise. Objective: steps 2 and 3 measure it. Diátaxis does not supply it; checking against the source does.
- **Deep quality** — flow, anticipating the reader's next need, fitting how people actually work. A matter of judgement, and only possible on top of functional quality. Walk the site as each reader from step 1 and note where the path breaks.

Then the gaps per type:

- **Tutorials**: is there a start-to-finish lesson for each major way a newcomer starts? A quickstart that makes choices for the reader and ends in a working result counts; an install page does not.
- **How-to guides**: list the real tasks users perform (from issues, discussions, support questions, the product surface). Which have no recipe?
- **Reference**: the missing and partial items from step 3.
- **Explanation**: which design decisions and core concepts does a reader need to trust the product that no page explains?

## 5. Present the map

Present, for approval before any edit:

- **Findings**: functional defects with evidence, deep-quality breaks, gaps per type, and questions only the maintainers can answer.
- **Direction**: the nav tree the site is heading toward, grouped by Diátaxis type, using the house style's section names if it has them. For sites with several products or audiences, group by product or audience first and by type within each — this is the skill's guidance, not Diátaxis's.
- **The step list**: small improvements, each a single action on one page or section (edit / split / merge / move / new / delete) with a one-line reason, highest reader impact first. Moves and deletes list their redirects.

If the house style names a place for plans (an issue tracker, a planning doc), put the map there as well.

## 6. Improve in small steps

Take the next step from the list and run the page steps from [`diataxis-docs.md`](diataxis-docs.md) for it: assess the piece, decide the single action that improves it, finish it, build, and publish or hand it over for review in the project's usual way. Report progress against the step list, and revise the list when a finished step reveals something new. Done when every step is complete or explicitly deferred by the user.
