import type { CriterionStatus } from "@/lib/types";

export function round(value: number, digits = 2): number {
  const p = Math.pow(10, digits);
  return Math.round(value * p) / p;
}

export function calculateMarketCapEst(
  per: number | null | undefined,
  netIncome: number | null | undefined,
): number | null {
  if (per == null || netIncome == null) {
    return null;
  }
  return per * netIncome;
}

export function calculatePbrEst(
  per: number | null | undefined,
  eps: number | null | undefined,
  bps: number | null | undefined,
): number | null {
  if (per == null || eps == null || bps == null || bps === 0) {
    return null;
  }
  return (per * eps) / bps;
}

export function calculateMaxDrawdown(closes: number[]): number | null {
  if (closes.length === 0) {
    return null;
  }

  let peak = closes[0];
  let maxDrawdown = 0;

  for (const close of closes) {
    if (close > peak) {
      peak = close;
    }
    if (peak <= 0) {
      continue;
    }
    const drawdown = (peak - close) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return maxDrawdown;
}

export function calculateHighPositionRatio(
  latestClose: number | null,
  fiveYearHigh: number | null,
): number | null {
  if (latestClose == null || fiveYearHigh == null || fiveYearHigh <= 0) {
    return null;
  }
  return latestClose / fiveYearHigh;
}

export function evaluateThreePointGrowth(values: Array<number | null | undefined>): CriterionStatus {
  if (values.length < 3) {
    return "PENDING";
  }
  if (values.some((value) => value == null)) {
    return "PENDING";
  }

  const [a, b, c] = values as number[];
  return a < b && b < c ? "PASS" : "FAIL";
}

export function normalizeScore(
  evaluations: Array<{ status: CriterionStatus; weight: number }>,
): {
  score: number;
  coverage: number;
  pendingCount: number;
} {
  let availableWeight = 0;
  let earnedWeight = 0;
  let availableCount = 0;
  let pendingCount = 0;

  for (const item of evaluations) {
    if (item.status === "PENDING") {
      pendingCount += 1;
      continue;
    }

    availableWeight += item.weight;
    availableCount += 1;
    if (item.status === "PASS") {
      earnedWeight += item.weight;
    }
  }

  const score = availableWeight > 0 ? (earnedWeight / availableWeight) * 100 : 0;
  const coverage = evaluations.length > 0 ? (availableCount / evaluations.length) * 100 : 0;

  return {
    score: round(score, 2),
    coverage: round(coverage, 2),
    pendingCount,
  };
}

