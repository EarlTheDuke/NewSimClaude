# CityWithLifeClaude — Working Agreement (read first)

This file auto-loads every session in this repo. It is the operating manual; the
*direction* lives in the docs it points to. Keep it short — link, don't duplicate.

## Read before planning any new phase or feature

> **Current active direction — the free-market program (read these first).** The three NORTH-STAR
> core moves are delivered; the live work is a three-leg program: **[INITIATIVE-01-WAGE-CIRCULATION.md](INITIATIVE-01-WAGE-CIRCULATION.md)**
> (free labour market, done) → **[INITIATIVE-02-BUSINESS-CREATION.md](INITIATIVE-02-BUSINESS-CREATION.md)**
> (creation & industries, done) → **[INITIATIVE-03-COMPETITION.md](INITIATIVE-03-COMPETITION.md)**
> (competition, done) → **[INITIATIVE-04-GDP-GROWTH.md](INITIATIVE-04-GDP-GROWTH.md)** (GDP growth
> — **✅ COMPLETE THROUGH THE C4 MONEY FORK, 2026-06-09**: C1 credit; C2 *the plateau*; C4 path
> (a) conserving trade — bounded lift that *outlives* its battery — AND path (b) the audited
> Monetary Authority — *unbounded* lift; C5 answered with evidence). Decision record + both
> results: **[INITIATIVE-04-C4-MONEY-FORK.md](INITIATIVE-04-C4-MONEY-FORK.md)**. The conservation
> invariant is now *conserved-and-audited* (see below); the default city and the CEO bench never
> mint and stay strictly conserved. Everything flag-gated + byte-identical at default; ~508 tests.

1. **[NORTH-STAR.md](NORTH-STAR.md)** — the post-v1 compass. Re-read at every phase
   boundary and check proposed work against the three moves (wants-grow-with-wealth →
   business entry → close the investment loop), the sequencing, and the
   realism-vs-benchmark tension. If a feature doesn't ladder up to it, say so *before* building.
2. **[ROADMAP.md](ROADMAP.md)** — the forward *sequence* of economic phases (16+): what's
   next and in what order, folding the 2026-06-06 economic-model audit's gaps. Consult it
   with NORTH-STAR when picking the next phase.
3. **[MASTER-PLAN.md](MASTER-PLAN.md)** — architecture & guiding principles. Its Phase 0–8
   roadmap shipped as v1.0; treat it as the standing design reference, not a to-do list.
4. **[PHASE9-PLAYTEST.md](PHASE9-PLAYTEST.md)** — where routine progress and the live
   Phase 12 plan actually live. Update this for day-to-day work (NORTH-STAR.md only when the
   *direction* genuinely changes).
5. **[VISION-RENDER.md](VISION-RENDER.md) + [PHASE-RENDER.md](PHASE-RENDER.md)** — the
   visualization track: the "10× more watchable" vision and its phased, browser-gated plan
   (decision-narrative moat → Pixi foundation → sprites/vehicles/flow → charts/story → sound).
   Read these before any rendering/UX work. *Rendering only reads* — these never touch the sim.
   **Current rendering direction: [PHASE-RENDER-R4-BROADCAST.md](PHASE-RENDER-R4-BROADCAST.md)**
   — the six-wave "dashboard → broadcast" program (leaderboard tower, thought cam, drama booth,
   juice pass, eval bar, director), user-greenlit 2026-06-10.

## Non-negotiable invariants (breaking one is a bug, not a tradeoff)
- **Determinism is sacred.** Seeded RNG only; no `Math.random`, no wall-clock, no
  Set/Map iteration-order surprises. A run must reproduce exactly from its seed + snapshot.
- **The economy is conserved-and-audited.** Money moves *only* through `World.transfer` —
  **except** the ONE sanctioned monetary authority (C4 path b, user-greenlit 2026-06-09): the
  audited `World.mint`/`World.burn` primitives, which change the supply by exactly what they
  log. The auditable invariant: `world.totalMoney() === genesis + mintedTotal() − burnedTotal()`
  **to the cent across any number of ticks** — and the default city and the CEO bench never
  mint/burn, so they stay *strictly* conserved (counters 0 ⇒ the old invariant verbatim). Any
  OTHER change to the total is a bug, full stop. Non-cash quantities (inventory, capital) never
  touch the money invariant.
- **Every mind is behind the seam.** All AI decisions go through the model-agnostic
  `DecisionProvider` interface (rules / mock / Claude swap without touching the sim).
- **Rendering only reads.** The view layer may never mutate simulation state.
- **Explain economics in plain real-world terms.** Every economic-design choice gets a
  layman's "what this is in the real world" explanation, in the doc/comment and to the user.

## Verify pipeline (run from the project dir)
- `npm run typecheck`
- `npm run test:run`  ← the runner. **NEVER `npm test`** (watch mode hangs the agent).
- `npm run build`
Green on all three before committing. Throwaway/debug harnesses MUST be deleted before commit.

## Never commit
- `playthrough.save.json`, `play.command.json` (runtime artifacts, gitignored).
- Secrets of any kind (`.env`, credentials, API keys).
- Stage files by name; don't `git add -A` / `git add .`.

## Standing orders
- **Push after big builds / at good stopping points** → `https://github.com/EarlTheDuke/NewSimClaude`.
- **Do not port, fork, or copy `CityWithLifeGrok`** — inspiration only, never a code source.
- Proceed phase by phase, checkpointing each sub-phase; gate high-risk work (e.g. logistics
  trucks) behind a feature flag that defaults OFF.

## Autonomy
When given a phase or task, execute it end-to-end without pausing for approval:
- Make the reasonable default choice and proceed; note the choice, don't ask.
- Each slice: flag-gated/byte-identical, verify typecheck + test:run + build GREEN, commit, push, continue.
- Only stop to ask when: (a) a sacred invariant can't hold, (b) a direction/architecture fork
  has no clear default, (c) an irreversible or external action, or (d) tests can't go green
  after a genuine attempt. Otherwise: keep going.
