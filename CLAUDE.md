# CityWithLifeClaude — Working Agreement (read first)

This file auto-loads every session in this repo. It is the operating manual; the
*direction* lives in the docs it points to. Keep it short — link, don't duplicate.

## Read before planning any new phase or feature
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

## Non-negotiable invariants (breaking one is a bug, not a tradeoff)
- **Determinism is sacred.** Seeded RNG only; no `Math.random`, no wall-clock, no
  Set/Map iteration-order surprises. A run must reproduce exactly from its seed + snapshot.
- **The economy is closed.** Money moves *only* through `World.transfer`. `world.totalMoney()`
  is conserved to the cent across any number of ticks. Non-cash quantities (inventory,
  capital) never touch the money invariant.
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
- **Push after big builds / at good stopping points** → `https://github.com/EarlTheDuke/Sim-Claude-`.
- **Do not port, fork, or copy `CityWithLifeGrok`** — inspiration only, never a code source.
- Proceed phase by phase, checkpointing each sub-phase; gate high-risk work (e.g. logistics
  trucks) behind a feature flag that defaults OFF.
