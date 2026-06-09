# INITIATIVE #2: Business Creation & Industries — firms are *born*, not just healed

> Second experiment of the free-market direction (`VISION.md`), and the first leg of a
> **three-part program** the user greenlit as a whole (build all three, roll straight through):
>
> | | Initiative | Role | Status |
> |---|---|---|---|
> | **A** | **Business creation & industries** (this doc) | more firms + new industries are *born* into demand | **slice 1 SHIPPED** |
> | **B** | **Competition between firms** | rivals fight over customers *and* workers | next |
> | **C** | **GDP growth & scaling** | the economy compounds; the money-creation fork returns | then |
>
> The three reinforce each other in exactly this order: **creation** makes more firms and new
> industries → **competition** then has real rivals to fight over customers and labour →
> **scaling** needs both (a growing, variety-rich economy is made of more firms competing), and
> it is where the Initiative-#1 **money-creation fork** (closed economy pools/stalls — see
> `INITIATIVE-01-WAGE-CIRCULATION.md`) walks back in by design, picking up the shelved macro
> phases (credit/population/trade) from `ROADMAP.md`.
>
> **Ladders up to NORTH-STAR move #2** ("let new businesses be *born*, not just die"). This
> generalizes it from self-*healing* (refill the dead) to self-*expanding* (challenge the busy,
> then grow new kinds).

## Where this sits vs. what already exists

The city already had the **birth half of creative destruction** (`BusinessEntrySystem`, Phase
15 D): when a `BusinessKind` goes fully **extinct**, a resident-entrepreneur founds a fresh firm
to refill the niche — funded from their own pocket (a transfer, no money minted), staffed from
the jobless pool, and owned by the founder. That *heals*; it does not *expand*. This initiative
adds the expansion.

### The two architectural constraints that shape the whole plan (found by code audit)

1. **Storefronts can multiply; producers (today) cannot.** `EconomySystem.storeForResident`
   already splits resident demand across *all* active storefronts of a kind by **price +
   distance** (that's how the `secondDiner` scenario works). But `MarketSystem.producerOf()`
   finds a resource's producer by **first active match of kind** — so a *second* farm/factory
   would sit there never receiving a single B2B order. **⇒ Multiplying storefronts is cheap and
   safe today; multiplying producers needs a market change first.** This is why slice 1 is
   storefronts-only.

2. **Kinds and industries are static types.** `BusinessKind` / `ResourceKind` are union types and
   `ARCHETYPES` / `PRODUCER_OF` are fixed `Record`s. A genuinely **new industry** (a new kind /
   a new resource / a deeper B2B chain) means making this table **data-driven**. That's the
   biggest, last slice of this initiative — sequenced after the cheaper multiplication wins.

## The slice plan (small, flag-gated, default byte-identical — the house pattern)

### ✅ Slice 1 — Opportunity-driven storefront entry · SHIPPED (`f7017de`)
A storefront kind that is **alive but overstretched** attracts a *second* firm.
- **Trigger** (deterministic, read-only): every active firm of a storefront kind ran
  **capacity-bound** yesterday (`util ≥ OPPORTUNITY_UTIL = 0.97`, Phase-12c utilization) **and**
  is **solvent** (`cash ≥ NEW_FIRM_CAPITAL`), and the kind holds fewer than
  `MAX_FIRMS_PER_KIND = 2` active firms. A busy *and profitable* niche — not a dying one.
- **Where it opens:** the **residential cluster farthest from the incumbent** — real footfall
  (under-served customers) and a genuine geographic split (a co-located twin at equal price
  would lose every price+distance tie and starve). Mints a `Location` on an existing grid node
  and `reindex()`es; no node/road, so pathfinding is unchanged.
- **Conserving + deterministic**, off the same fund→staff→own machinery as heal. Staffs from the
  **jobless pool** — so it fires meaningfully when there's slack labour. (Poaching *employed*
  labour is Initiative **B**, by design — not smuggled in here.)
- **Flag:** `OPPORTUNITY_ENTRY=false` default ⇒ seeded city byte-identical. 394 tests green.
- **Real-world:** when the corner diner is slammed every lunch and still turning a profit, an
  entrepreneur opens a rival across town.

### ✅ Slice 2 — Multi-producer B2B (the unlock) · SHIPPED (`bb18b52`)
The supply chain now reaches **every active producer of a resource**, not just the first.
`MarketSystem.producerOf()` (first match) became `producersOf()` (the id-sorted pool); each
buyer's procurement is **split across the pool proportional to each producer's stock** (capped by
stock, remaining want, and the buyer's cash), and price utilization is measured against the
pool's **summed** capacity so added supply softens price instead of reading as overload.
- **Structural no-op** for the seeded city (one producer per resource ⇒ the loops collapse to the
  old math) — byte-identity guarded by the soak/determinism/round-trip suite. 397 tests green.
- `producerPool.test.ts` proves a two-farm town splits the bakery's grain orders across **both**
  farms, conserved + deterministic.
- **This is the prerequisite for slices 3–4 and for producer competition (B).**

### Slice 3 — Opportunity-driven producer entry
With slice 2 in place, extend the slice-1 opportunity trigger to **producers** (farm, mine,
bakery, factory): a capacity-bound, solvent producer of a resource the chain is short on attracts
a second producer. Same conserving birth machinery; now the new producer's output is actually
bought. Flag-gated.

### Slice 4 — Data-driven industries (the big one)
Make `BusinessKind` / `ResourceKind` / `ARCHETYPES` / `PRODUCER_OF` **data-driven** so genuinely
**new kinds and new industries** can exist (and, later, be *founded* into demand): a new service
sector, a deeper processing chain, product variety. Large refactor — sequenced last, behind the
cheaper multiplication wins, and gated so the default seven-business city is byte-identical.
Connects to the `ROADMAP.md` **texture track** (goods/services variety).

## Then: Initiative B (Competition) and C (GDP growth)

- **B — Competition between firms.** Creation gives rivals; now make rivalry *bite*. Price wars
  and share-stealing already exist for storefronts (`competition.test.ts`); extend to producers
  (post-slice-2), and wire **labour-market competition** — a short-staffed firm bids its wage up
  to **poach** from rivals (the free-wage market of Initiative #1 S1 finally has multiple firms
  to clear across). Entry/exit churn becomes a real competitive force. Draft `INITIATIVE-03-*`
  (or `-B-`) at that phase boundary.
- **C — GDP growth & scaling.** With creation + competition, the economy can *grow*: more firms,
  more output, more variety. This is where we measure **real GDP growth** and where the
  Initiative-#1 **money-creation fork** returns — picking up the shelved macro phases from
  `ROADMAP.md` (credit/banking `PHASE18-CREDIT.md`, population scaling, trade) to lift the
  demand/population/money-supply ceilings so the economy compounds instead of pooling.

## Invariants honored throughout (non-negotiable)
- **Closed economy:** every birth/firm move is a `World.transfer`; `totalMoney()` conserved to
  the cent. New firms mint nothing.
- **Deterministic:** seeded/derived order only, no RNG, no wall-clock; same seed + snapshot ⇒
  identical world (slice 1 has a determinism test; every slice will).
- **Flag-gated, default byte-identical:** the brain-off baseline stays identical until each slice
  is deliberately engaged — the 12a/13a/15/16/INIT1 pattern.
- **Realism in the world model; benchmark via frozen scenarios.** Creation/competition/scaling
  live in the world; the CEO bench keeps them OFF so the skill signal stays clean — and "when do
  I enter a market?" becomes a *new* curated benchmark decision.
