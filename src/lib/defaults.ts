import type { SamAssumptionInput, ScreeningWeights } from "@/lib/types";

export const APP_SETTING_KEYS = {
  weights: "screening.weights",
} as const;

export const DEFAULT_WEIGHTS: ScreeningWeights = {
  priceToSalesCheap: 1.3,
  netCashVsMarketCap: 1.2,
  samUpside: 1.0,
  perReasonable: 1.0,
  pbrUnderOne: 1.1,
  cashFlowHealth: 1.1,
  highPriceAvoidance: 0.9,
  growthConsistency: 1.0,
  equityStrengthBonus: 0.8,
  foreignOwnershipCheck: 0.6,
  textRiskCheck: 1.0,
};

export const DEFAULT_RISK_KEYWORDS = [
  "継続前提に重要事象",
  "継続企業の前提に関する重要事象",
  "継続企業の前提",
  "債務超過",
  "資金繰り",
  "借入金の返済",
  "期限の利益喪失",
  "重要な不確実性",
  "監査意見",
  "限定付適正意見",
  "意見不表明",
  "不適正意見",
  "破産",
  "民事再生",
  "事業再生",
  "倒産",
];

export const DEFAULT_SAM_ASSUMPTIONS: SamAssumptionInput[] = [
  { industry: "水産・農林業", sam: 2.0e12, assumedShare: 0.03, futureMultiple: 1.4 },
  { industry: "鉱業", sam: 1.5e12, assumedShare: 0.03, futureMultiple: 1.3 },
  { industry: "建設業", sam: 12.0e12, assumedShare: 0.02, futureMultiple: 1.4 },
  { industry: "食料品", sam: 14.0e12, assumedShare: 0.03, futureMultiple: 1.5 },
  { industry: "繊維製品", sam: 2.4e12, assumedShare: 0.03, futureMultiple: 1.4 },
  { industry: "パルプ・紙", sam: 1.8e12, assumedShare: 0.03, futureMultiple: 1.3 },
  { industry: "化学", sam: 10.0e12, assumedShare: 0.025, futureMultiple: 1.5 },
  { industry: "医薬品", sam: 9.0e12, assumedShare: 0.02, futureMultiple: 1.7 },
  { industry: "石油・石炭製品", sam: 6.0e12, assumedShare: 0.02, futureMultiple: 1.2 },
  { industry: "ゴム製品", sam: 1.6e12, assumedShare: 0.03, futureMultiple: 1.4 },
  { industry: "ガラス・土石製品", sam: 2.0e12, assumedShare: 0.03, futureMultiple: 1.4 },
  { industry: "鉄鋼", sam: 4.0e12, assumedShare: 0.02, futureMultiple: 1.3 },
  { industry: "非鉄金属", sam: 2.2e12, assumedShare: 0.025, futureMultiple: 1.4 },
  { industry: "金属製品", sam: 1.8e12, assumedShare: 0.03, futureMultiple: 1.4 },
  { industry: "機械", sam: 7.5e12, assumedShare: 0.025, futureMultiple: 1.5 },
  { industry: "電気機器", sam: 16.0e12, assumedShare: 0.02, futureMultiple: 1.6 },
  { industry: "輸送用機器", sam: 12.0e12, assumedShare: 0.02, futureMultiple: 1.5 },
  { industry: "精密機器", sam: 2.8e12, assumedShare: 0.03, futureMultiple: 1.5 },
  { industry: "その他製品", sam: 2.4e12, assumedShare: 0.03, futureMultiple: 1.5 },
  { industry: "電気・ガス業", sam: 6.0e12, assumedShare: 0.02, futureMultiple: 1.3 },
  { industry: "陸運業", sam: 4.5e12, assumedShare: 0.02, futureMultiple: 1.3 },
  { industry: "海運業", sam: 1.8e12, assumedShare: 0.03, futureMultiple: 1.3 },
  { industry: "空運業", sam: 1.4e12, assumedShare: 0.03, futureMultiple: 1.4 },
  { industry: "倉庫・運輸関連業", sam: 1.7e12, assumedShare: 0.03, futureMultiple: 1.4 },
  { industry: "情報・通信業", sam: 18.0e12, assumedShare: 0.02, futureMultiple: 1.8 },
  { industry: "卸売業", sam: 10.0e12, assumedShare: 0.02, futureMultiple: 1.4 },
  { industry: "小売業", sam: 11.0e12, assumedShare: 0.02, futureMultiple: 1.4 },
  { industry: "銀行業", sam: 13.0e12, assumedShare: 0.015, futureMultiple: 1.2 },
  { industry: "証券、商品先物取引業", sam: 2.2e12, assumedShare: 0.03, futureMultiple: 1.3 },
  { industry: "保険業", sam: 3.5e12, assumedShare: 0.025, futureMultiple: 1.3 },
  { industry: "その他金融業", sam: 3.0e12, assumedShare: 0.025, futureMultiple: 1.4 },
  { industry: "不動産業", sam: 8.0e12, assumedShare: 0.02, futureMultiple: 1.4 },
  { industry: "サービス業", sam: 8.5e12, assumedShare: 0.025, futureMultiple: 1.6 },
];

export const CRITERIA_LABELS = {
  priceToSalesCheap: "売上に対して割安",
  netCashVsMarketCap: "ネットキャッシュ優位",
  samUpside: "SAM上振れ余地",
  perReasonable: "PER妥当性",
  pbrUnderOne: "PBR 1未満",
  cashFlowHealth: "資金の流れが健全",
  highPriceAvoidance: "高値づかみ回避",
  growthConsistency: "3期連続成長",
  equityStrengthBonus: "自己資本の厚み",
  foreignOwnershipCheck: "第三者保有確認",
  textRiskCheck: "危険ワード判定",
} as const;

export const DRAW_DOWN_PRICE_THRESHOLD_RATIO = 0.8;
