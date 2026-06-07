import { describe, it, expect } from "vitest";
import { occupantsByHome, hasVacancy, cheapestVacantHome } from "./housing";

describe("housing helpers (HP1)", () => {
  describe("occupantsByHome", () => {
    it("counts residents per home id", () => {
      const m = occupantsByHome([
        { homeId: "a" },
        { homeId: "a" },
        { homeId: "b" },
      ]);
      expect(m.get("a")).toBe(2);
      expect(m.get("b")).toBe(1);
      expect(m.get("c")).toBeUndefined();
    });

    it("is empty for no residents", () => {
      expect(occupantsByHome([]).size).toBe(0);
    });
  });

  describe("hasVacancy", () => {
    it("is true only while occupants are below capacity", () => {
      expect(hasVacancy(1, 2)).toBe(true);
      expect(hasVacancy(2, 2)).toBe(false);
      expect(hasVacancy(3, 2)).toBe(false);
      expect(hasVacancy(0, 1)).toBe(true);
    });
  });

  describe("cheapestVacantHome (HP3-2)", () => {
    // home_0: pricey/big, home_1 & home_2: cheap (tie), home_2 the smallest.
    const homes = [
      { id: "loc_home_0", type: "home", rent: 70, capacity: 2 },
      { id: "loc_home_1", type: "home", rent: 62, capacity: 2 },
      { id: "loc_home_2", type: "home", rent: 62, capacity: 1 },
      { id: "loc_shop", type: "workplace" },
    ];

    it("returns the cheapest home with a free slot", () => {
      const residents = [{ homeId: "loc_home_0" }]; // home_0 1/2; all others empty
      expect(cheapestVacantHome(residents, homes)).toBe("loc_home_1");
    });

    it("breaks rent ties by lowest location id", () => {
      expect(cheapestVacantHome([], homes)).toBe("loc_home_1"); // 62 tie -> lower id
    });

    it("skips a full cheap home for a pricier vacant one", () => {
      const residents = [
        { homeId: "loc_home_1" },
        { homeId: "loc_home_1" }, // home_1 2/2 full
        { homeId: "loc_home_2" }, // home_2 1/1 full
      ];
      expect(cheapestVacantHome(residents, homes)).toBe("loc_home_0");
    });

    it("returns undefined when every home is full", () => {
      const residents = [
        { homeId: "loc_home_0" },
        { homeId: "loc_home_0" }, // 2/2
        { homeId: "loc_home_1" },
        { homeId: "loc_home_1" }, // 2/2
        { homeId: "loc_home_2" }, // 1/1
      ];
      expect(cheapestVacantHome(residents, homes)).toBeUndefined();
    });

    it("ignores non-home locations and treats missing capacity as unbounded", () => {
      expect(cheapestVacantHome([], [{ id: "loc_shop", type: "workplace" }])).toBeUndefined();
      // A home with no explicit capacity still accepts occupants (back-compat).
      const legacy = [{ id: "loc_legacy", type: "home", rent: 50 }];
      expect(cheapestVacantHome([{ homeId: "loc_legacy" }], legacy)).toBe("loc_legacy");
    });
  });
});
