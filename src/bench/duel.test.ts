import { describe, it, expect } from "vitest";
import { runDuel, runHomeAndAway, type ProviderFactory } from "./duel";
import { PerBusinessProvider } from "../ai/PerBusinessProvider";
import { RuleBasedProvider } from "../ai/RuleBasedProvider";
import { DEFAULT_LIMITS } from "../ai/clamp";
import type {
  BusinessDecision,
  BusinessObservation,
  DecisionProvider,
  DecisionRequest,
} from "../ai/types";

const rules: ProviderFactory = () => new RuleBasedProvider();

/** A mind that records which firms it was asked about (routing-hygiene probe). */
class SeenProvider implements DecisionProvider {
  readonly id = "seen";
  readonly seen = new Set<string>();
  decide(req: DecisionRequest): BusinessDecision {
    this.seen.add(req.observation.businessId);
    return { action: {}, reason: "watching" };
  }
}

describe("PerBusinessProvider — the seat router (Pilot B)", () => {
  const obs = (businessId: string): DecisionRequest => ({
    observation: { businessId } as BusinessObservation,
    limits: DEFAULT_LIMITS,
  });

  it("routes each firm to its own mind — information hygiene by construction", async () => {
    const a = new SeenProvider();
    const b = new SeenProvider();
    const router = new PerBusinessProvider({ biz_x: a, biz_y: b });
    await router.decide(obs("biz_x"));
    await router.decide(obs("biz_y"));
    await router.decide(obs("biz_x"));
    expect([...a.seen]).toEqual(["biz_x"]); // a never saw y's books
    expect([...b.seen]).toEqual(["biz_y"]);
  });

  it("an unmapped seat throws (→ the agent's rules fallback covers, loudly logged)", () => {
    const router = new PerBusinessProvider({ biz_x: new SeenProvider() });
    expect(() => router.decide(obs("biz_unrouted"))).toThrow(/no provider routed/);
  });

  it("the optional catch-all takes unmapped seats instead", async () => {
    const all = new SeenProvider();
    const router = new PerBusinessProvider({}, all);
    await router.decide(obs("biz_anything"));
    expect([...all.seen]).toEqual(["biz_anything"]);
  });
});

describe("the twin-diner duel (Pilot B)", () => {
  it(
    "is deterministic with sync minds: the same match replays to the identical result",
    async () => {
      const config = { seed: 9, days: 30, a: { label: "rules-A", make: rules }, b: { label: "rules-B", make: rules } };
      const one = await runDuel(config);
      const two = await runDuel(config);
      expect(two).toEqual(one);
      expect(one.moneyConserved).toBe(true);
      expect(one.a.decisions).toBe(30);
      expect(one.b.decisions).toBe(30);
      expect(one.a.fellBack).toBe(0);
    },
    120_000,
  );

  it(
    "home-and-away cancels the seat asymmetry: identical brains tie EXACTLY",
    async () => {
      const m = await runHomeAndAway({
        seed: 9,
        days: 30,
        a: { label: "rules-A", make: rules },
        b: { label: "rules-B", make: rules },
      });
      // The same deterministic mind plays both seats across the pair, so each total is the sum
      // of the same two seat-scores — the harness's own fairness proof, exact to the cent.
      expect(m.aTotal).toBeCloseTo(m.bTotal, 9);
      expect(m.winner).toBe("tie");
      // And the swap really swapped: game 2's home seat carries game 1's away label.
      expect(m.games[1]!.a.label).toBe("rules-B");
      expect(m.games[1]!.a.seat).toBe("biz_diner");
    },
    240_000,
  );

  it(
    "each game constructs FRESH minds (ledger hygiene): the factory is called per game",
    async () => {
      let built = 0;
      const counting: ProviderFactory = () => {
        built++;
        return new RuleBasedProvider();
      };
      await runHomeAndAway({
        seed: 9,
        days: 5,
        a: { label: "A", make: counting },
        b: { label: "B", make: rules },
      });
      expect(built).toBe(2); // one fresh mind per game for A (home game + away game)
    },
    120_000,
  );
});
