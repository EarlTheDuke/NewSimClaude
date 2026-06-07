import { describe, it, expect } from "vitest";
import { occupantsByHome, hasVacancy } from "./housing";

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
});
