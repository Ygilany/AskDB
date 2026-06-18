# AskDB Public Launch Plan

A practical, sequenced plan for announcing AskDB to the public (X, Reddit, Hacker
News, and supporting channels). Copy blocks below are drafts — edit voice and
trim before posting.

- **Repo:** https://github.com/Ygilany/AskDB
- **Site:** https://ygilany.github.io/AskDB
- **npm:** `@askdb/core`, `askdb` (CLI), `@askdb/postgres`, `@askdb/mysql`,
  `@askdb/sqlite`, `@askdb/sqlserver`, `@askdb/rag`, `@askdb/introspect`,
  `@askdb/tui`, `@askdb/prisma`, …
- **License:** Apache-2.0
- **Status at launch:** pre-1.0 (`1.0.0-beta.x`) — be honest about this; it is an
  asset, not a liability (early, shapeable, BYO).

---

## 1. Positioning (decide this first — everything else flows from it)

**One-liner**
> AskDB is an open-source developer toolkit that turns natural-language questions
> into validated, schema-grounded SQL, then hands the SQL back to *your* app to
> run. BYO model, BYO database, BYO vector store.

Use this same top-line message on the README, website hero, npm package
description where space allows, and launch posts. The shorter wording is sharper
than "natural-language analytics" because it names the concrete artifact
(`SQL`) and the trust boundary (`your app runs it`).

**The hook (why it's different):** Most "text-to-SQL" tools want to connect to
your database and run queries for you. AskDB deliberately does **not** execute.
It generates SQL grounded in a human-enriched schema and returns it as an
artifact your app reviews, approves, logs, and runs under your own roles and
tenant policy. The trust boundary is the product.

**Three pillars to repeat everywhere:**
1. **Schema-grounded, not vibes** — answers are anchored to an enriched schema
   artifact (descriptions, aliases, business concepts), not raw DDL guessing.
2. **You keep control of execution** — AskDB returns SQL; your app decides what
   runs. Sensitive-field markers, multi-tenant scoping, modes.
3. **Embeddable + BYO everything** — npm packages with a stable `@askdb/core`;
   bring your own LLM key, DB connection, embedder, and vector store. Library /
   CLI / HTTP / Studio / TUI share one engine.

**Who you're talking to (lead with #1):**
- Builders/integrators embedding "ask your data" into their own product.
- Agent/LLM-tooling builders (MCP/CLI, headless, stable I/O).
- Postgres/data-platform engineers tired of black-box NL→SQL.

**Avoid:** overclaiming ("replaces your analyst"), implying it executes queries,
or hiding the beta status.

---

## 2. Assets to prepare BEFORE launch day (readiness checklist)

Do not announce until these are true. A launch lives or dies on the first 30
seconds of a stranger's attention.

**Must-have**
- [ ] A 60–90s **demo** (animated GIF + a short screen-recording / Loom).
      Show: `askdb introspect` → enrich → `askdb ask "..."` → SQL out. This is
      the single highest-leverage asset for HN/X/Reddit.
- [ ] **Website is live** and the above-the-fold answers "what / who / why" in
      one screen, with a copy-paste quickstart that *actually works* on a clean
      machine.
- [ ] **2-minute quickstart verified** from a clean dir (`npm i @askdb/core
      @askdb/postgres ...` → first SQL). Time it. Remove every friction step.
- [ ] README top section matches the website one-liner exactly (consistency).
- [ ] npm install smoke test passes (`pnpm smoke:install`) and package pages
      render (description, README, repo link, license).
- [ ] GitHub repo hygiene: description + topics set, social preview image,
      `good first issue` labels, Discussions enabled, pinned "Start here" issue.
- [ ] LICENSE (Apache-2.0 ✓), CONTRIBUTING ✓, SECURITY ✓, SUPPORT ✓ present and
      linked.
- [ ] A short **FAQ** anticipating launch questions (see §6) — on the site or
      README, so you can link instead of retyping.
- [ ] Basic **analytics** on the site (Plausible/Umami/GA) so you can read the
      launch.

**Nice-to-have**
- [ ] A written launch blog post (Dev.to / Hashnode / personal) — the "why I
      built this" narrative. Doubles as the HN/Reddit first comment.
- [ ] A comparison note (vs. running a raw LLM SQL agent, vs. hosted tools) —
      framed honestly, not as attack copy.
- [ ] A live example / playground or a recorded Studio walkthrough.
- [ ] Decide beta vs. tagging a clean `v0.x`/release on GitHub with notes.

### Demo video plan

Make one polished **60-90s narrated screencast** first, then cut a **25-35s
silent captioned MP4/GIF** from the same recording for X, README embeds, and
Reddit. Do not make the primary asset graphics-only: for developer audiences,
credibility comes from seeing the real CLI / Studio flow work.

**Recommended format**
- Primary: narrated screencast with burned-in captions so it also works muted.
- Social cut: silent, captioned, fast-moving, focused on the payoff and SQL
  output.
- First public clip: use the **CLI** for the cold open because it is the fastest
  to understand visually. Use Node.js and HTTP/curl examples as follow-up clips
  or docs snippets for deeper integrator proof.
- Visual rule: every screen should reinforce one of the three pillars:
  schema-grounded, execution control, or BYO/embeddable.

**Structure: start with the end, then rewind**
1. **Cold open / payoff (8-12s):** show `askdb ask` returning SQL for a plain
   English question. Add a clear on-screen callout: "SQL returned for review.
   Nothing executed by AskDB."
2. **Rewind / setup (40-55s):** show how that result was made trustworthy:
   `askdb init`, `askdb introspect`, a quick enrichment moment in Studio or TUI,
   then the same `askdb ask` flow.
3. **Close / trust boundary (10-15s):** restate the launch hook: AskDB grounds
   SQL in your schema, returns it as an artifact, and your app decides what runs
   under your roles, tenant policy, and audit logging.

This "show the end first" structure is not confusing if the transition is
explicit: "Now here's how we got there." It helps strangers understand the value
before they see setup steps.

**Storyboard + proposed script (about 75s)**

**0-5s — Title card / terminal already visible**
Narration:
> AskDB turns plain-English questions into validated, schema-grounded SQL.

On-screen text:
```
Natural language -> SQL
Execution stays in your app
```

**5-14s — Cold open: ask a question**
Show:
```bash
askdb ask \
  --schema pagila.schema \
  --question "Which customers rented the most films last month?"
```

Narration:
> Here's the end result: ask a question, get SQL back.

On-screen callout:
```
AskDB returns SQL. It does not execute it.
```

**14-22s — SQL output**
Show the generated SQL in the terminal. Pause long enough for the shape of the
query to be readable.

Narration:
> Your product can review, approve, log, parameterize, or reject this before
> anything touches the database.

**22-26s — Rewind transition**
On-screen text:
```
How we got there
```

Narration:
> Now here's what makes that query grounded.

**26-36s — Init + introspection**
Show:
```bash
askdb init
askdb introspect --url "$DATABASE_URL" --out pagila.schema --schema-id pagila
```

Narration:
> First, AskDB creates a schema artifact from your database metadata.

**36-50s — Enrichment**
Show Studio or TUI briefly: table descriptions, aliases, business concepts,
common query language, or example questions.

Narration:
> Then you enrich that artifact with the language your product and users
> actually use: descriptions, aliases, and business concepts.

**50-62s — Ask again after enrichment**
Show the `askdb ask` command again, or Studio's sample NL-to-SQL panel if it
looks clearer.

Narration:
> That enriched schema becomes the grounding context for natural-language to SQL.

**62-72s — Execution boundary**
Show SQL output beside a simple callout.

Narration:
> AskDB still does not run the query. It hands SQL back to your app, where your
> own roles, tenant policy, approval flow, and audit logs stay in control.

On-screen text:
```
Schema-grounded
SQL returned, not executed
BYO model, database, embedder, vector store
```

**72-80s — Close**
Show repo/site URL.

Narration:
> AskDB is open source, Apache-2.0, pre-1.0, and built for developers embedding
> ask-your-data workflows into their own products.

---

## 3. Sequencing (don't fire everything at once)

Spreading channels over ~2 weeks lets you fix what the first audience breaks,
and gives each post its own news cycle.

**T‑minus 1 week — soft / friendly audience**
- Tag a GitHub release with notes. Tweet/X a low-key "it's public" from your
  own account. Share in any Discords/Slacks you're already in. Post to
  **r/SideProject** and **Indie Hackers** (forgiving audiences, good for
  catching obvious bugs and first feedback).

**Day 1 (Tue–Thu, ~8–10am US Eastern) — Hacker News "Show HN"**
- Highest-signal, highest-risk channel. Do it on a day you can sit with it for
  6–8 hours to answer every comment. See §4 for the post + first comment.

**Day 1–2 — X / Twitter thread**
- Launch the thread the same morning as HN so momentum compounds. Pin it.

**Day 2–4 — Reddit (staggered, one subreddit at a time)**
- Lead with the most relevant: **r/PostgreSQL**, **r/dataengineering**, then
  **r/node** / **r/javascript**, **r/LocalLLaMA** (BYO-model angle),
  **r/opensource**, **r/selfhosted**, **r/programming** (strict — only if the
  post is genuinely substantial). Read each sub's self-promotion rules first;
  reframe the title per subreddit, never cross-post identical text.

**Day 3–5 — Lobste.rs** (if you have an invite) and **dev.to/Hashnode** blog
post.

**Week 2 — Product Hunt** (optional). PH rewards a coordinated day; only do it
once the site/demo are polished and you can rally a few early supporters.

**Ongoing — Newsletters/aggregators:** submit to Node Weekly, JavaScript
Weekly, Console.dev, Postgres Weekly, TLDR, Bytes. These pick up GitHub-trending
and Show HN posts, so a strong HN day feeds them.

---

## 4. Channel drafts (copy-paste, then edit to taste)

### Hacker News — Show HN

**Title** (≤80 chars, no hype words, factual):
```
Show HN: AskDB – natural-language-to-SQL toolkit you embed in your app
```
**URL:** link to the GitHub repo (or the site if it has the demo above the fold).

**First comment (post immediately as the author — this is the real pitch):**
```
Author here. AskDB turns a natural-language question into validated,
schema-grounded SQL — but it deliberately does NOT execute the query. It hands
the SQL back to your app, which decides whether to show, approve, run, and log
it under your own DB roles and tenant policy.

The design bet: for "ask your data" inside a real product, the hard part isn't
the LLM call — it's grounding, trust, and execution control. So AskDB is a set
of npm packages (Apache-2.0), not a hosted service:

- Schema artifact you enrich with descriptions/aliases/business concepts
  (introspect Postgres, then enrich via TUI or a local Studio UI). Same artifact
  feeds RAG and the NL->SQL prompt.
- BYO everything that touches secrets: your LLM key, DB connection, embedder,
  vector store. @askdb/core is the stable surface; CLI/HTTP/TUI/Studio are
  consumers of it.
- Postgres is the reference engine; MySQL/SQLite/SQL Server adapters ship too.
- Multi-tenant scoping and sensitive-field markers are first-class.

It's pre-1.0 (beta on npm) and I'd love feedback on the schema-enrichment
workflow and the "return SQL, don't execute" boundary specifically. Quickstart
and architecture docs are in the repo. Happy to answer anything.
```
Tips: reply to *every* comment, especially critical ones, calmly and
technically. Don't ask for upvotes. Don't relaunch the same title within months.

### X / Twitter — thread

```
1/ I just open-sourced AskDB 🧵

It turns plain-English questions into validated SQL — grounded in your real
schema — and hands the SQL back to YOUR app to run.

No black box. No "let the AI hit your prod DB." Apache-2.0, on npm today.

2/ Most text-to-SQL tools want to connect to your database and run queries.

AskDB does the opposite: it returns SQL as a reviewable artifact. Your app
decides what executes — under your roles, tenant policy, and audit logging.

The trust boundary IS the product.

3/ How it stays accurate: a schema artifact you enrich with descriptions,
aliases, and business concepts.

Introspect Postgres → enrich in a TUI or local Studio UI → that same artifact
grounds the prompt (and RAG). Not raw-DDL guessing.

[demo GIF]

4/ It's a developer toolkit, not a SaaS:

• @askdb/core — stable NL→SQL engine
• CLI, HTTP API, TUI, Studio UI — all share the core
• BYO model key, DB, embedder, vector store
• Postgres-first; MySQL / SQLite / SQL Server adapters too

5/ Multi-tenant scoping and sensitive-field markers are built in, so generated
SQL respects tenant boundaries and you can keep flagged columns out of prompts
and embeddings.

6/ It's pre-1.0 and I want feedback — especially on the enrichment workflow and
the "return SQL, don't execute" boundary.

⭐ Repo: github.com/Ygilany/AskDB
📦 npm: @askdb/core
🌐 ygilany.github.io/AskDB

RTs hugely appreciated 🙏
```
Add the demo GIF/video to tweet 3 (highest engagement spot). Pin the thread.

### Reddit

Reddit punishes anything that smells like an ad. Lead with substance, use a
plain title, write a real post body, and engage in comments. One subreddit per
day; never paste identical text across subs.

**r/PostgreSQL / r/dataengineering** (title):
```
I built an open-source NL→SQL toolkit that returns SQL instead of running it (Postgres-first, Apache-2.0)
```
**Body:**
```
I kept hitting the same wall with "ask your data" features: the LLM part is easy,
but grounding it in a real schema and keeping execution under control is not.

AskDB is my take — an npm toolkit (not a hosted service) that:
- introspects your Postgres schema, then lets you enrich it with
  descriptions/aliases/business concepts (TUI or a local web UI),
- uses that enriched artifact to generate validated SQL from a question,
- returns the SQL as an artifact — your app runs it under your own roles, tenant
  policy, and audit logging. AskDB never executes.

BYO model key / DB / embedder / vector store. Postgres is the reference dialect;
MySQL/SQLite/SQL Server adapters exist. It's pre-1.0 and I'd genuinely like
feedback on the schema-enrichment workflow and whether the "don't execute"
boundary matches how you'd want to deploy this.

Repo + quickstart: github.com/Ygilany/AskDB
```
**r/LocalLLaMA** — reframe around BYO/local models:
```
NL→SQL toolkit where you bring your own model (OpenAI-compatible / local), and it returns SQL instead of touching your DB
```
**r/node / r/javascript** — reframe around the package/DX:
```
Show & tell: @askdb/core — embed natural-language→SQL in your Node app, BYO model, returns SQL for you to run
```

### Dev.to / Hashnode / personal blog — "Why I built AskDB"

Narrative post (also reusable as HN/Reddit comment context):
- The problem: every product wants "ask your data," and naive LLM-on-DB is
  unsafe and inaccurate.
- The insight: schema grounding + a hard execution boundary.
- The design: enriched schema artifact, BYO everything, one core / many
  surfaces.
- Walkthrough with the demo GIF and the 2-minute quickstart.
- Honest "what's not done yet" (pre-1.0, roadmap link), and an explicit ask for
  contributors / feedback.

### Lobste.rs / Product Hunt
- **Lobste.rs:** tag `databases`, `ai`/`ml`, `show`. Same factual title as HN.
- **Product Hunt:** tagline = the one-liner; first comment = the blog narrative;
  line up a handful of early supporters for the morning (PT).

---

## 5. Messaging guardrails (keep yourself honest)

- ✅ "Returns validated SQL for review" — ❌ "runs queries on your database."
- ✅ "Schema-grounded" — ❌ "always correct" / "replaces analysts."
- ✅ "Pre-1.0, beta on npm, feedback wanted" — ❌ hide the maturity.
- ✅ "Guardrails are heuristic (not a full SQL parser)" — state limitations; HN
  will find them anyway and reward the honesty.
- Lead with the differentiator (execution boundary + enrichment), not a feature
  list.

---

## 6. Anticipated questions — have answers ready

- *How is this different from Vanna / LangChain SQL agent / hosted tools?* →
  Toolkit you embed (not SaaS), explicit execution boundary, human-enriched
  schema artifact, BYO everything, multi-tenant + sensitive-field controls.
- *Does it run my queries?* → No. It returns SQL; your app executes under your
  controls.
- *Which models?* → BYO, OpenAI-compatible; per-provider recipes in docs
  (OpenAI, Anthropic, Bedrock, Ollama, AI Gateway).
- *Which databases?* → Postgres is the reference; MySQL/SQLite/SQL Server
  adapters ship, parity tracked on the roadmap.
- *How accurate is it?* → Depends on enrichment quality; that's the point of the
  schema artifact. Heuristic guardrails today, not a full parser.
- *Is it production-ready?* → Pre-1.0; stable `@askdb/core` surface, but treat as
  beta. Roadmap link.
- *MCP server?* → Roadmap (mention if/when true).
- *Pricing / hosted?* → Open-source (Apache-2.0), self-hosted, BYO keys; no
  hosted offering today.

---

## 7. Launch-day checklist & metrics

**Day-of**
- [ ] Post HN ~8–10am ET; post author's first comment immediately.
- [ ] Launch X thread same morning; pin it.
- [ ] Clear your calendar for 6–8h to respond everywhere.
- [ ] Watch GitHub issues; triage fast, label, thank contributors.
- [ ] Keep the FAQ link handy for repeated questions.

**Track (and write down a baseline first)**
- GitHub stars / forks / new issues & PRs, traffic (repo Insights).
- npm downloads (`@askdb/core` and CLI) — check the npm trends.
- Site visits + quickstart→docs funnel (analytics).
- HN points/rank/comments; X impressions/profile visits; Reddit upvotes/comments.
- Qualitative: what confused people in the first 2 minutes → fix it the next day.

**Success ≠ front page.** Success = real developers trying the quickstart, filing
useful issues, and a few becoming repeat users/contributors. Optimize the
follow-up (answer everything, ship fixes visibly) more than the launch spike.

---

## 8. After the spike (week 2+)

- Ship the most-requested fix from launch feedback publicly and thank the
  reporters (signals momentum).
- Submit to newsletters/aggregators (§3) referencing the HN traction.
- Write a short "launch retro" post with numbers — itself a sharable artifact.
- Convert interested people into contributors: pin a roadmap, label `good first
  issue`, respond to PRs quickly.
- Consider a follow-up angle a few weeks later (e.g. the MCP server, or a deep
  dive on the enrichment/RAG format) as a *second* news cycle.
</content>
</invoke>
