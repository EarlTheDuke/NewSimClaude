# CityWithLifeClaude — North Star

**Status:** Active true-north (post-v1 direction)
**Adopted:** 2026-06-04
**Purpose:** The high-level compass for what we build next. Read this at the start of every new phase or feature and check the proposed work against it *before* planning. This is the current *direction*; [MASTER-PLAN.md](MASTER-PLAN.md) remains the architecture & guiding-principles reference (its Phase 0–8 roadmap shipped as v1.0).

## How to use this document
- **At every phase boundary**, re-read this and ask of any proposed work: *which of the three moves does it serve, does it respect the sequencing, and does it honor the realism-vs-benchmark tension?*
- We are always serving three goals at once: **(1) realism, (2) a lifelike + growing + sustainable sim, (3) a clean LLM-benchmark environment.** The best moves serve more than one.
- This is the gold standard. If a proposed feature doesn't ladder up to it, say so before building.

---

## The gold standard (verbatim)

The highest-leverage moves each serve several goals at once:

**1. Let wants grow with wealth — the keystone.**
Realism: real people don't have fixed appetites; as they get richer they buy more, and fancier (meals out, services, status goods, bigger homes). Growth: this is the only thing that lifts the demand ceiling — which is what finally makes capital, productivity, and investment pay off instead of sitting inert. Benchmark: an uncapped market is the only kind where a skilled LLM CEO can pull away from a mediocre one; with a hard ceiling everyone scores the same. → serves all three. Single most important unlock.

**2. Let new businesses be born, not just die — self-healing.**
Realism: "creative destruction" — a profitable empty niche attracts a new firm. Sustainability: directly fixes the 4/8 collapse; firm count self-balances instead of decaying. Benchmark: "when do I enter a market?" is a rich decision to test. → mostly sustainability + benchmark depth.

**3. Close the investment loop (12c + owners).**
Route profit to owners (today it leaks evenly to everyone), give them an invest lever, let them plow profit into capacity or new firms. The productivity engine — but it only bites after #1 creates demand headroom. → growth, and it's the agency story the benchmark needs.

Bigger, riskier realism levers I'd gate as optional toggles for later: population lifecycle (births/aging/death — the most genuinely "alive," and a clean growth driver), banking/credit (flexes the money supply and funds investment, but threatens the conservation invariant — needs careful design), external trade (a port that buys exports — injects outside demand, breaks the closed ceiling). Plus the texture that makes it feel alive: more goods/services, households/relationships, skills and inequality, neighborhoods and land value.

### The tension worth holding onto
Realism and benchmark-clarity pull against each other. A maximally realistic economy — credit cycles, population swings, random shocks — can get so noisy that an LLM's score reflects luck, not skill. Benchmarks want the opposite: freeze most of the world, expose one clean decision surface, hold the seed fixed, measure marginal skill. Your CEO harness already does this. So the likely move: build realism into the world model, but benchmark through curated scenarios that switch most of it off and spotlight one domain (pricing, investment, market entry, supply-chain ops). The determinism you already have is the gold.

### If I had to sequence it
Wants-grow-with-wealth (#1) → business entry (#2) → close the invest loop (#3, now with somewhere to bite). That arc turns a flat, half-dying town into a growing, self-healing, benchmarkable one, each step unlocking the next. Main tradeoff: #1 changes core consumption behavior, so it moves every existing number and soak baseline — highest value and highest blast radius, unlike the 12a/b no-ops.

Your two "later" items fold right in: the better window into the world is also the agent's observation space (the human dashboard and the machine-legible observation are the same work), and hooking me up to play is mostly that observation/action surface plus the seam you already built — so both converge with the benchmark goal rather than being separate tracks.

---

## Quick-reference checklist (distilled — scan before each phase)

- [ ] **#1 Wants grow with wealth** — the keystone. Lifts the demand ceiling; unlocks capital/investment; gives the benchmark score-separation. Highest value, highest blast radius (moves every number + every soak baseline).
- [ ] **#2 Business entry** — new firms are *born*, not just die. Self-heals collapse (the 4/8); adds market-entry as a testable decision.
- [ ] **#3 Close the investment loop** — profit → owners, invest lever, reinvest. Productivity engine; only bites *after* #1 makes demand headroom.
- [ ] **Sequence:** #1 → #2 → #3.
- [ ] **Gate behind toggles, later:** population lifecycle, banking/credit, external trade; plus texture (goods/services, households, skills/inequality, neighborhoods/land value).
- [ ] **Hold the tension:** build realism into the *world model*; benchmark via *curated scenarios* that freeze most of it and spotlight one decision domain. Determinism is the gold.
- [ ] **Later, converging:** a better window into the world == the agent's observation space; "Claude plays" == that observation/action surface + the existing brain seam.

---

*Living document. Update it when the direction genuinely changes — not for routine progress (that lives in PHASE9-PLAYTEST.md).*
