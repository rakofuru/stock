export type CriterionKey =
  | "priceToSalesCheap"
  | "netCashVsMarketCap"
  | "samUpside"
  | "perReasonable"
  | "pbrUnderOne"
  | "cashFlowHealth"
  | "highPriceAvoidance"
  | "growthConsistency"
  | "equityStrengthBonus"
  | "foreignOwnershipCheck"
  | "textRiskCheck";

export type CriterionStatus = "PASS" | "FAIL" | "PENDING";

export interface ScreeningWeights {
  priceToSalesCheap: number;
  netCashVsMarketCap: number;
  samUpside: number;
  perReasonable: number;
  pbrUnderOne: number;
  cashFlowHealth: number;
  highPriceAvoidance: number;
  growthConsistency: number;
  equityStrengthBonus: number;
  foreignOwnershipCheck: number;
  textRiskCheck: number;
}

export interface SamAssumptionInput {
  industry: string;
  sam: number;
  assumedShare: number;
  futureMultiple: number;
}

export interface CriterionEvaluation {
  key: CriterionKey;
  label: string;
  status: CriterionStatus;
  weight: number;
  note?: string;
  value?: number | string | null;
  threshold?: number | string | null;
}

export interface ScreeningMetrics {
  marketCapEst: number | null;
  pbrEst: number | null;
  priceToSales: number | null;
  totalLiabilities: number | null;
  netCash: number | null;
  latestClose: number | null;
  fiveYearHigh: number | null;
  highPositionRatio: number | null;
  maxDrawdownPct: number | null;
  industryAveragePer: number | null;
}

export interface CollectionRunSummary {
  cycleId: string;
  status: "RUNNING" | "PAUSED" | "COMPLETED" | "FAILED";
  processedThisRun: number;
  cursor: number;
  totalCompanies: number;
  remainingToday: number;
  message?: string;
}

