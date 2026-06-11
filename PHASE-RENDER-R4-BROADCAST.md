# PHASE-RENDER-R4 — THE BROADCAST (from dashboard to show)

> **BUILD STATUS (2026-06-10):** ✅ Wave 1 (Leaderboard Tower) · ✅ Wave 2 (Thought Cam —
> witnessed live: qwen's 3.1-min wage-war deliberation on camera) · ✅ Wave 3 (Drama Booth
> banners + records) · ✅ Wave 4a (coins on real sales, pennants, drop shadows) · ✅ Wave 4b
> (the map at 800px CSS / 1.5× backing store — picking unaffected, all pointer math
> normalizes; supply-chain COIN GLIDES: the nightly B2B settlement sends coins from each
> consumer firm to its producer via the industry registry's consumes/produces chain) ·
> 🔨 Wave 5 next (eval bar + match framing) · Wave 6 queued. *(Deferred to follow-ups: a full
> palette/ground-texture art pass; canvas-renderer parity for juice — R2 waiver applies.)*

*Created 2026-06-10, user-greenlit ("let's do all 1–6 over time… jump directly into this build").
The R4 program follows R3 (street-level visuals) and shares its constitution:*
**rendering only reads — the view layer never mutates simulation state; everything here is
presentation over the deterministic core.**

## The diagnosis (why R4 exists)

The sim is currently a **dashboard**: it shows numbers and lets a patient viewer find the story.
Watchable things are **broadcasts**: they find the story for you, attach it to characters with
names and stakes, show who's winning RIGHT NOW, and build anticipation before events, not after.

And this project has one asset nobody else has: **our players think out loud.** Every LLM
decision arrives with its verbatim reason (and its think-time). A chess broadcast would kill for
a window into the player's head — we have that window, and until R4 we printed it in a tiny
gray ticker.

## The six waves (the program — all greenlit, built over time)

1. **WAVE 1 — The Leaderboard Tower + danger badges.** Persistent F1-style rail: every player
   firm ranked by the official score, with momentum and bankruptcy-countdown badges. Fixes
   "who's winning" forever. *(This wave's slices are specced below — building now.)*
2. **WAVE 2 — The Thought Cam.** When a decision lands, a styled card: firm colors, the action
   as chips (`PRICE $13→$14` `HIRE +1`), the model's reason as a verbatim quote, the think time.
   The duel becomes two minds arguing through a town. *(Also wave-1-adjacent; specced below.)*
3. **WAVE 3 — The Play-by-Play Booth.** Drama-ranked events: kill-feed banners for bankruptcies,
   poachings, foundings, disasters, press flips; records & milestones ("highest single-day
   revenue this match"); quiet scroll for the rest.
4. **WAVE 4 — The Juice Pass + firm identity.** Art direction on the existing top-down map:
   cohesive palette, soft shadows, money particles flowing along roads (circulation made
   visible), firm logos/colors (players get jerseys), buildings that visibly grow with brand,
   bigger canvas share. (Tier-3 isometric rebuild deliberately deferred until the show earns it.)
5. **WAVE 5 — The Eval Bar + match framing.** Live win-probability needle between contestants
   (score gap + momentum); day-end standings beat; pre-match tale-of-the-tape; post-match
   report card auto-written from the decision logs; a persistent season ladder of models.
6. **WAVE 6 — The Director.** Auto-camera that finds the story (zoom to a landing decision,
   follow the poached worker, pull wide for the boat); highlight bookmarks on a timeline;
   deterministic replay of bookmarked moments; viewer-as-God audience participation (vote the
   storm, flip the press).

## The KPI catalog (what "how is each player doing" means)

**Per firm/CEO (the players):**
- **Growth Score** — productive worth (cash capped at reserve + inventory@anchor + capital +
  brand) minus its baseline at watch start. The official score; the same arithmetic as the
  benchmark instrument (`firmProductiveWorth`, one valuation truth).
- **Rank + movement** (▲▼ vs yesterday) · **momentum** (7-day score trend).
- **Cash runway** — days to $0 at the recent burn rate; the bankruptcy countdown badge.
- **Market share** of its niche · **staff + wage posture** (× base) · **price posture** (vs the
  going rate) · **brand**.
- **Last move + reason, verbatim** — the mind on display (LLM cards also show think time,
  fallback/missed-turn rate, and discovery moments).
- **Owner's personal fortune** vs the firm's value (dividends taken vs value built).

**Per resident (the supporting cast):** wallet + wealth rank, wage + employer, life events,
rags-to-riches index. **Town (the stage):** GDP, Gini, unemployment, velocity, population —
the weather report, not the main show.

## WAVE 1+2 build plan (the current build)

| Slice | What ships | Acceptance |
|---|---|---|
| **R4-1a** | `src/render/broadcast.ts` — read-only broadcast module: per-firm scorecard math (score, rank, momentum, runway, postures) sampled once per sim-day off `world` + shared `firmProductiveWorth`; baselines anchored at page load. | Pure presentation; unit-testable math; no sim writes. |
| **R4-1b** | The Tower DOM rail (left of the map, all scenarios): rank, color chip, name, score, momentum arrow, runway badge (amber <15d, red <7d), staff/price/wage posture line. Rebuilt on day change + decision landings, not per frame. | Visible in default/boom/duel; glanceable in <1s; selected firm highlights; click row → select firm on map. |
| **R4-2a** | Thought Cam cards: watch `agent.decisions()` for new entries; card slides in with firm color, provider label, action chips, verbatim reason, think time (LLM cards big, rules cards quiet). Auto-dismiss; max 2 stacked. | qwen's deliberations readable as they land in the duel; no card spam from rules firms. |
| **R4-2b** | Action-chip formatter shared with the booth (PRICE/HIRE/INVEST/WAGE/BRAND/RETAIN chips from a `BusinessAction`). | Used by cards now, booth banners in Wave 3. |
| **R4-3 (stretch)** | First drama banners: bankruptcy / founding / poach / press-on / first-sail full-width interrupts, drawn from the existing events feed. | Big moments visually interrupt; everything else stays quiet. |

Verification per slice: typecheck + tests + build green, live check in `?scenario=duel&think=1`
and `?scenario=boom`, zero console errors. Default demo stays functional (tower simply lists
the seven firms). Commit per slice; push at wave end.

## Standing constraints

- **Rendering only reads.** The broadcast module receives `world` / decision logs / events as
  read-only inputs and returns DOM/strings. No system, no serialization, no sim import cycles.
- **One valuation truth:** all scores via the exported bench helpers — never re-derived.
- **The scored instrument stays headless** (duelCli home-and-away). The broadcast is the booth,
  not the referee.
- Wall-clock animation is fine (cards, fades); sim state never depends on it.
