import { describe, expect, test } from "vitest";
import {
  calculateHighPositionRatio,
  calculateMarketCapEst,
  calculateMaxDrawdown,
  calculatePbrEst,
  evaluateThreePointGrowth,
  normalizeScore,
} from "@/lib/screening/calculations";

describe("screening calculations", () => {
  test("calculateMarketCapEst returns PER * net income", () => {
    expect(calculateMarketCapEst(12, 1000)).toBe(12000);
    expect(calculateMarketCapEst(null, 1000)).toBeNull();
  });

  test("calculatePbrEst returns (PER * EPS) / BPS", () => {
    expect(calculatePbrEst(10, 100, 500)).toBe(2);
    expect(calculatePbrEst(10, 100, 0)).toBeNull();
  });

  test("calculateMaxDrawdown works with peak-to-trough series", () => {
    const drawdown = calculateMaxDrawdown([100, 120, 110, 90, 95]);
    expect(drawdown).toBeCloseTo(0.25);
  });

  test("calculateHighPositionRatio returns current/high", () => {
    expect(calculateHighPositionRatio(80, 100)).toBe(0.8);
    expect(calculateHighPositionRatio(null, 100)).toBeNull();
  });

  test("evaluateThreePointGrowth detects ascending trend", () => {
    expect(evaluateThreePointGrowth([1, 2, 3])).toBe("PASS");
    expect(evaluateThreePointGrowth([1, 1, 2])).toBe("FAIL");
    expect(evaluateThreePointGrowth([1, null, 2])).toBe("PENDING");
  });

  test("normalizeScore excludes PENDING from denominator", () => {
    const result = normalizeScore([
      { status: "PASS", weight: 2 },
      { status: "FAIL", weight: 1 },
      { status: "PENDING", weight: 1 },
    ]);

    expect(result.score).toBeCloseTo(66.67, 1);
    expect(result.coverage).toBeCloseTo(66.67, 1);
    expect(result.pendingCount).toBe(1);
  });
});
