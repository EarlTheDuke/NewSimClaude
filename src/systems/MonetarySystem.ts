import type { System, SystemContext } from "../core/types";
import { TICKS_PER_DAY } from "../core/TimeSystem";
import type { World } from "../world/World";
import { MONETARY_ENABLED, MONETARY_DAILY_GROWTH_RATE, MONETARY_DAILY_MINT_CAP } from "./constants";

/**
 * Monetary policy (Initiative C / C4 path b) — THE DELIBERATE RELAXATION of strict conservation,
 * engaged only by the user's explicit decision (2026-06-09). Once a day the Monetary Authority
 * issues new money under a deterministic, bounded rule:
 *
 *   daily issue = min(rate × current total supply, hard daily cap)
 *
 * minted at the authority via the audited {@link World.mint} (the ONE sanctioned doorway — the
 * ledger keeps `totalMoney() === genesis + minted − burned` to the cent), then **helicoptered**
 * to every resident as an even conserving transfer. Growing the supply proportionally to itself
 * is exactly how fiat money grows — and is what makes demand, and nominal GDP, *unbounded*: the
 * property path (a)'s finite battery could not give.
 *
 * Real-world: a central bank running a fixed money-growth rule (a Friedman k-percent rule), with
 * the proceeds distributed as a citizen's dividend — the simplest honest injection channel, since
 * it touches no relative price and favours no firm.
 *
 * Inert three ways by default: {@link MONETARY_ENABLED} off, rate 0, cap 0 — all must be
 * deliberately set (and an authority seeded via `includeAuthority`) before a cent is created, so
 * the default city is byte-identical and strictly conserved. Runs right after the welfare floor
 * (both are transfers-to-residents on the settled day) and before lifecycle/macro, so the day's
 * issue is in wallets before solvency is judged and vitals are sampled. Deterministic: pure
 * arithmetic on the supply, fixed resident order, no RNG. Stateless — the audit ledger lives on
 * the World (snapshot-complete), so save/reload resumes policy exactly.
 */
export class MonetarySystem implements System {
  readonly id = "monetary";

  constructor(
    private readonly world: World,
    /** Whether the press is live; defaults to {@link MONETARY_ENABLED} (off ⇒ inert). */
    private readonly enabled: boolean = MONETARY_ENABLED,
    /** Daily supply growth, as a fraction of the current total; defaults to {@link MONETARY_DAILY_GROWTH_RATE} (0 ⇒ inert). */
    private rate: number = MONETARY_DAILY_GROWTH_RATE,
    /** Hard $/day mint ceiling; defaults to {@link MONETARY_DAILY_MINT_CAP} (0 ⇒ inert — the bound must be set deliberately). */
    private cap: number = MONETARY_DAILY_MINT_CAP,
  ) {}

  /**
   * God's monetary lever (the live view's policy panel / dev handle): change the k-percent rule
   * mid-run without rebuilding the world — a deliberate intervention, like a GodMode strike.
   * Headless runs, tests, and the bench never call this, so their constructor policy stands; the
   * audited mint doorway (and the `enabled` master gate) is unchanged. Real-world: the central
   * bank announcing a new money-growth target.
   */
  setPolicy(rate: number, cap: number): void {
    this.rate = rate;
    this.cap = cap;
  }

  /** The current policy rule, for HUD display. */
  policy(): { rate: number; cap: number } {
    return { rate: this.rate, cap: this.cap };
  }

  update(ctx: SystemContext): void {
    if (!this.enabled || ctx.totalTicks === 0 || ctx.totalTicks % TICKS_PER_DAY !== 0) return;
    if (this.rate <= 0 || this.cap <= 0) return; // both bounds must be deliberately engaged
    const authority = this.world.getBusiness("biz_authority");
    if (!authority || !authority.active) return; // policy needs its institution (strictly opt-in)
    const residents = this.world.residents;
    if (residents.length === 0) return;

    // The k-percent rule, hard-capped: today's issue, created at the authority through the ONE
    // audited doorway, then passed straight through to every resident in equal shares.
    const daily = Math.min(this.world.totalMoney() * this.rate, this.cap);
    if (daily <= 0) return;
    this.world.mint(authority.id, daily);
    const share = daily / residents.length;
    for (const r of residents) {
      this.world.transfer(authority.id, r.id, share); // authority → resident; conserving transfer
    }
  }
}
