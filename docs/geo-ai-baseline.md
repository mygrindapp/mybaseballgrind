# GEO / AI-Answer Baseline

Purpose: measurable starting point for whether MyGrind (and its blog posts) surface in
web + AI-engine answers for target queries. Re-run periodically to track GEO progress.
Upgrade path for true AI-citation tracking: Ahrefs Brand Radar (MCP connected, needs a plan
with API access; current plan returns "Insufficient plan").

## Baseline — 2026-06-27 (web search, US)

| Query | MyGrind in top 10? | Who owns the answer today |
|---|---|---|
| best training journal app for youth baseball/softball | No | WIN Reality, Diamond Kinetics, Blast Motion, HitTrax, MOJO, Thinking Baseball |
| how to choose a high school for a baseball player | No | Hitters Baseball Academy, NCSA, Baseball Dudes, Baseball America |
| when should I switch travel teams | No | D1 Baseball Offer, The Hitting Vault, Dirt on my Diamonds, SeamsUp |
| NCAA core GPA eligibility | No | NCSA (dominant), mynextplay, 2aDays, College Board, NCAA.org |

### Read
MyGrind is not yet surfacing for any target query. The category answers are dominated by
established training-tech brands (WIN Reality, Diamond Kinetics) and the recruiting giant NCSA.
Closest opening: the "training journal" angle is mostly answered by swing-analysis apps and a
generic Evernote mention, so a purpose-built "training journal app" identity is an unclaimed lane.
The NCAA-GPA and travel-team queries are NCSA/forum territory; our blog posts must earn citations
on depth + the named-coach E-E-A-T signal.

### Changes shipped same day (2026-06-27, working tree, pre-deploy)
- E-E-A-T author upgrade on all 10 blog posts: visible byline now
  "By Coach Mike Young - 35 years coaching youth baseball & softball ..." and BlogPosting.author
  changed from Organization to a Person node linked by @id to the canonical #founder entity.
- Verified live: /llms.txt (200) and /robots.txt AI-bot rules (GPTBot, ClaudeBot, PerplexityBot,
  Google-Extended) present.
- Organization sameAs already present sitewide on the homepage #organization node.

### Next re-run checklist
- Repeat the 4 queries above; note any MyGrind/blog appearance + position.
- Add an actual AI-engine pass (ChatGPT/Perplexity/Google AI Overviews) once tooling allows.
- If GEO becomes a priority, price Ahrefs Brand Radar for share-of-voice + citation tracking.
