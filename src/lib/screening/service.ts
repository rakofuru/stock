import { Prisma } from "@prisma/client";
import { CRITERIA_LABELS, DRAW_DOWN_PRICE_THRESHOLD_RATIO } from "@/lib/defaults";
import { prisma } from "@/lib/prisma";
import { ensureDefaultSettings, getRiskKeywords, getSamAssumptions, getWeights } from "@/lib/settings";
import {
  calculateHighPositionRatio,
  calculateMarketCapEst,
  calculateMaxDrawdown,
  calculatePbrEst,
  evaluateThreePointGrowth,
  normalizeScore,
  round,
} from "@/lib/screening/calculations";
import type {
  CriterionEvaluation,
  CriterionStatus,
  ScreeningMetrics,
  ScreeningWeights,
} from "@/lib/types";

interface RunScreeningOptions {
  minScore?: number;
}

interface LatestScreeningFilter {
  page: number;
  perPage: number;
  minScore?: number;
  maxScore?: number;
  minCoverage?: number;
  maxCoverage?: number;
  minPendingCount?: number;
  maxPendingCount?: number;
  minPbr?: number;
  maxPbr?: number;
  minPsr?: number;
  maxPsr?: number;
  minNetCash?: number;
  maxNetCash?: number;
  minDrawdownPct?: number;
  maxDrawdownPct?: number;
  gatePassed?: boolean;
  industries?: string[];
  q?: string;
  sortBy: "score" | "coverage" | "pendingCount" | "companyName" | "gatePassed";
  sortOrder: "asc" | "desc";
}

function average(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function evaluate(
  key: keyof ScreeningWeights,
  status: CriterionStatus,
  weight: number,
  note?: string,
  value?: number | string | null,
  threshold?: number | string | null,
): CriterionEvaluation {
  return {
    key,
    label: CRITERIA_LABELS[key],
    status,
    weight,
    note,
    value: value ?? null,
    threshold: threshold ?? null,
  };
}

function getIndustryAveragePer(
  companies: { edinetCode: string; industry: string | null }[],
  latestFinancialMap: Map<string, { per: number | null }>,
) {
  const perByIndustry = new Map<string, number[]>();

  for (const company of companies) {
    if (!company.industry) {
      continue;
    }

    const latest = latestFinancialMap.get(company.edinetCode);
    if (!latest?.per || latest.per <= 0) {
      continue;
    }

    const list = perByIndustry.get(company.industry) ?? [];
    list.push(latest.per);
    perByIndustry.set(company.industry, list);
  }

  const averages = new Map<string, number>();
  for (const [industry, values] of perByIndustry.entries()) {
    const value = average(values);
    if (value != null) {
      averages.set(industry, value);
    }
  }

  return averages;
}

export async function runScreening(options: RunScreeningOptions = {}) {
  await ensureDefaultSettings();

  const [weights, samAssumptions, riskKeywords, companies, financials] = await Promise.all([
    getWeights(),
    getSamAssumptions(),
    getRiskKeywords(),
    prisma.company.findMany({ orderBy: { edinetCode: "asc" } }),
    prisma.financial.findMany({
      orderBy: [{ edinetCode: "asc" }, { fiscalYear: "desc" }],
    }),
  ]);

  const run = await prisma.screeningRun.create({
    data: {
      status: "RUNNING",
      weightsJson: weights as unknown as Prisma.InputJsonValue,
    },
  });

  const samByIndustry = new Map(samAssumptions.map((row) => [row.industry, row]));

  const financialMap = new Map<string, typeof financials>();
  for (const row of financials) {
    const list = financialMap.get(row.edinetCode) ?? [];
    list.push(row);
    financialMap.set(row.edinetCode, list);
  }

  const latestFinancialMap = new Map<string, (typeof financials)[number]>();
  for (const [edinetCode, series] of financialMap.entries()) {
    const latest = [...series].sort((a, b) => b.fiscalYear - a.fiscalYear)[0];
    if (latest) {
      latestFinancialMap.set(edinetCode, latest);
    }
  }

  const industryAveragePer = getIndustryAveragePer(companies, latestFinancialMap);
  const enabledKeywords = riskKeywords.filter((row) => row.enabled).map((row) => row.keyword);

  let gatePassedCount = 0;
  let totalScore = 0;
  let resultCount = 0;

  for (const company of companies) {
    const series = financialMap.get(company.edinetCode) ?? [];
    const latest = latestFinancialMap.get(company.edinetCode);

    const totalLiabilities =
      latest?.totalAssets != null && latest.netAssets != null
        ? latest.totalAssets - latest.netAssets
        : null;

    const marketCapEst = calculateMarketCapEst(latest?.per, latest?.netIncome);
    const pbrEst = calculatePbrEst(latest?.per, latest?.eps, latest?.bps);

    const priceToSales =
      marketCapEst != null && latest?.revenue != null && latest.revenue > 0
        ? marketCapEst / latest.revenue
        : null;

    const netCash = latest?.cash != null && totalLiabilities != null ? latest.cash - totalLiabilities : null;

    const priceRows = await prisma.priceDaily.findMany({
      where: { edinetCode: company.edinetCode },
      orderBy: { date: "asc" },
      select: { close: true },
    });

    const closes = priceRows.map((row) => row.close);
    const latestClose = closes.length > 0 ? closes[closes.length - 1] : null;
    const fiveYearHigh = closes.length > 0 ? Math.max(...closes) : null;
    const highPositionRatio = calculateHighPositionRatio(latestClose, fiveYearHigh);
    const maxDrawdown = calculateMaxDrawdown(closes);

    const industryPer = company.industry ? industryAveragePer.get(company.industry) ?? null : null;
    const sam = company.industry ? samByIndustry.get(company.industry) : undefined;

    const evaluations: CriterionEvaluation[] = [];

    evaluations.push(
      priceToSales == null
        ? evaluate("priceToSalesCheap", "PENDING", weights.priceToSalesCheap)
        : evaluate(
            "priceToSalesCheap",
            priceToSales < 1 ? "PASS" : "FAIL",
            weights.priceToSalesCheap,
            undefined,
            round(priceToSales, 3),
            1,
          ),
    );

    evaluations.push(
      marketCapEst == null || netCash == null
        ? evaluate("netCashVsMarketCap", "PENDING", weights.netCashVsMarketCap)
        : evaluate(
            "netCashVsMarketCap",
            marketCapEst < netCash ? "PASS" : "FAIL",
            weights.netCashVsMarketCap,
            undefined,
            round(marketCapEst),
            round(netCash),
          ),
    );

    const samFutureValue = sam ? sam.sam * sam.assumedShare * sam.futureMultiple : null;
    evaluations.push(
      marketCapEst == null || samFutureValue == null
        ? evaluate("samUpside", "PENDING", weights.samUpside)
        : evaluate(
            "samUpside",
            marketCapEst < samFutureValue ? "PASS" : "FAIL",
            weights.samUpside,
            undefined,
            round(marketCapEst),
            round(samFutureValue),
          ),
    );

    if (latest?.per == null || latest.per <= 0 || industryPer == null) {
      evaluations.push(evaluate("perReasonable", "PENDING", weights.perReasonable));
    } else {
      const perThreshold = Math.max(14, industryPer * 1.1);
      evaluations.push(
        evaluate(
          "perReasonable",
          latest.per <= perThreshold ? "PASS" : "FAIL",
          weights.perReasonable,
          undefined,
          round(latest.per, 2),
          round(perThreshold, 2),
        ),
      );
    }

    evaluations.push(
      pbrEst == null
        ? evaluate("pbrUnderOne", "PENDING", weights.pbrUnderOne)
        : evaluate("pbrUnderOne", pbrEst < 1 ? "PASS" : "FAIL", weights.pbrUnderOne, undefined, round(pbrEst, 2), 1),
    );

    if (latest?.cfInvesting == null) {
      evaluations.push(evaluate("cashFlowHealth", "PENDING", weights.cashFlowHealth));
    } else {
      const cashCondition = netCash != null ? netCash >= 0 : latest.cash != null ? latest.cash >= 0 : null;
      evaluations.push(
        cashCondition == null
          ? evaluate("cashFlowHealth", "PENDING", weights.cashFlowHealth)
          : evaluate(
              "cashFlowHealth",
              cashCondition && latest.cfInvesting < 0 ? "PASS" : "FAIL",
              weights.cashFlowHealth,
            ),
      );
    }

    evaluations.push(
      highPositionRatio == null
        ? evaluate("highPriceAvoidance", "PENDING", weights.highPriceAvoidance)
        : evaluate(
            "highPriceAvoidance",
            highPositionRatio <= DRAW_DOWN_PRICE_THRESHOLD_RATIO ? "PASS" : "FAIL",
            weights.highPriceAvoidance,
            undefined,
            round(highPositionRatio, 3),
            DRAW_DOWN_PRICE_THRESHOLD_RATIO,
          ),
    );

    const ordered = [...series].sort((a, b) => a.fiscalYear - b.fiscalYear);
    const latestThree = ordered.slice(-3);

    const revenueStatus = evaluateThreePointGrowth(latestThree.map((f) => f.revenue));
    const operatingStatus = evaluateThreePointGrowth(latestThree.map((f) => f.operatingIncome));
    const ordinaryStatus = evaluateThreePointGrowth(latestThree.map((f) => f.ordinaryIncome));

    let growthStatus: CriterionStatus = "PENDING";
    if (revenueStatus === "FAIL" || operatingStatus === "FAIL" || ordinaryStatus === "FAIL") {
      growthStatus = "FAIL";
    } else if (revenueStatus === "PASS" && operatingStatus === "PASS" && ordinaryStatus === "PASS") {
      growthStatus = "PASS";
    }

    evaluations.push(evaluate("growthConsistency", growthStatus, weights.growthConsistency));

    evaluations.push(
      latest?.equityRatioOfficial == null
        ? evaluate("equityStrengthBonus", "PENDING", weights.equityStrengthBonus)
        : evaluate(
            "equityStrengthBonus",
            latest.equityRatioOfficial >= 0.7 ? "PASS" : "FAIL",
            weights.equityStrengthBonus,
            undefined,
            round(latest.equityRatioOfficial, 3),
            0.7,
          ),
    );

    evaluations.push(
      evaluate(
        "foreignOwnershipCheck",
        "PENDING",
        weights.foreignOwnershipCheck,
        "EDINET v1では外国人・投資信託保有比率を取得できないため、未評価です。",
      ),
    );

    const cachedTextBlocks = await prisma.textBlock.findMany({
      where: { edinetCode: company.edinetCode },
      select: { text: true },
    });

    if (cachedTextBlocks.length === 0 || enabledKeywords.length === 0) {
      evaluations.push(evaluate("textRiskCheck", "PENDING", weights.textRiskCheck));
    } else {
      const corpus = cachedTextBlocks.map((row) => row.text).join("\n");
      const matched = enabledKeywords.filter((keyword) => corpus.includes(keyword));
      evaluations.push(
        evaluate(
          "textRiskCheck",
          matched.length === 0 ? "PASS" : "FAIL",
          weights.textRiskCheck,
          matched.length > 0 ? `検出ワード: ${matched.join(", ")}` : undefined,
        ),
      );
    }

    const gatePassed = (latest?.cfOperating ?? Number.NEGATIVE_INFINITY) > 0 && (latest?.equityRatioOfficial ?? 0) >= 0.5;

    const metrics: ScreeningMetrics = {
      marketCapEst,
      pbrEst,
      priceToSales,
      totalLiabilities,
      netCash,
      latestClose,
      fiveYearHigh,
      highPositionRatio,
      maxDrawdownPct: maxDrawdown == null ? null : round(maxDrawdown * 100, 2),
      industryAveragePer: industryPer ?? null,
    };

    const scoreData = normalizeScore(evaluations);

    await prisma.screeningResult.create({
      data: {
        runId: run.id,
        edinetCode: company.edinetCode,
        gatePassed,
        score: scoreData.score,
        coverage: scoreData.coverage,
        pendingCount: scoreData.pendingCount,
        marketCapEst,
        pbrEst,
        priceToSales,
        netCash,
        maxDrawdownPct: metrics.maxDrawdownPct,
        criteriaJson: evaluations as unknown as Prisma.InputJsonValue,
        metricsJson: metrics as unknown as Prisma.InputJsonValue,
      },
    });

    if (gatePassed) {
      gatePassedCount += 1;
    }

    totalScore += scoreData.score;
    resultCount += 1;
  }

  const avgScore = resultCount > 0 ? round(totalScore / resultCount, 2) : 0;

  await prisma.screeningRun.update({
    where: { id: run.id },
    data: {
      status: "COMPLETED",
      endedAt: new Date(),
      summaryJson: {
        totalCompanies: resultCount,
        gatePassedCount,
        averageScore: avgScore,
        minScoreFilter: options.minScore ?? 0,
      } as Prisma.InputJsonValue,
    },
  });

  return {
    runId: run.id,
    totalCompanies: resultCount,
    gatePassedCount,
    averageScore: avgScore,
  };
}

function numberRangeFilter(min?: number, max?: number): Prisma.FloatFilter | undefined {
  if (min == null && max == null) {
    return undefined;
  }
  return {
    gte: min,
    lte: max,
  };
}

function nullableNumberRangeFilter(min?: number, max?: number): Prisma.FloatNullableFilter | undefined {
  if (min == null && max == null) {
    return undefined;
  }
  return {
    gte: min,
    lte: max,
  };
}

function intRangeFilter(min?: number, max?: number): Prisma.IntFilter | undefined {
  if (min == null && max == null) {
    return undefined;
  }
  return {
    gte: min,
    lte: max,
  };
}

function normalizeIndustryFilters(industries?: string[]) {
  if (!industries) {
    return [];
  }
  const unique = new Set<string>();
  for (const industry of industries) {
    const normalized = industry.trim();
    if (normalized) {
      unique.add(normalized);
    }
  }
  return [...unique];
}

function buildOrderBy(filter: LatestScreeningFilter): Prisma.ScreeningResultOrderByWithRelationInput[] {
  const sortOrder = filter.sortOrder;

  switch (filter.sortBy) {
    case "coverage":
      return [{ coverage: sortOrder }, { score: "desc" }, { company: { name: "asc" } }];
    case "pendingCount":
      return [{ pendingCount: sortOrder }, { score: "desc" }, { company: { name: "asc" } }];
    case "companyName":
      return [{ company: { name: sortOrder } }, { score: "desc" }];
    case "gatePassed":
      return [{ gatePassed: sortOrder }, { score: "desc" }, { company: { name: "asc" } }];
    case "score":
    default:
      return [{ score: sortOrder }, { company: { name: "asc" } }];
  }
}

export async function getLatestScreening(filter: LatestScreeningFilter) {
  const run = await prisma.screeningRun.findFirst({
    where: { status: "COMPLETED" },
    orderBy: { startedAt: "desc" },
  });

  if (!run) {
    return {
      run: null,
      pagination: {
        page: filter.page,
        perPage: filter.perPage,
        total: 0,
        totalPages: 0,
      },
      facets: {
        industries: [],
      },
      data: [],
    };
  }

  const industries = normalizeIndustryFilters(filter.industries);
  const query = filter.q?.trim();
  const whereAnd: Prisma.ScreeningResultWhereInput[] = [{ runId: run.id }];

  const scoreRange = numberRangeFilter(filter.minScore, filter.maxScore);
  if (scoreRange) {
    whereAnd.push({ score: scoreRange });
  }

  const coverageRange = numberRangeFilter(filter.minCoverage, filter.maxCoverage);
  if (coverageRange) {
    whereAnd.push({ coverage: coverageRange });
  }

  const pendingRange = intRangeFilter(filter.minPendingCount, filter.maxPendingCount);
  if (pendingRange) {
    whereAnd.push({ pendingCount: pendingRange });
  }

  const pbrRange = nullableNumberRangeFilter(filter.minPbr, filter.maxPbr);
  if (pbrRange) {
    whereAnd.push({ pbrEst: pbrRange });
  }

  const psrRange = nullableNumberRangeFilter(filter.minPsr, filter.maxPsr);
  if (psrRange) {
    whereAnd.push({ priceToSales: psrRange });
  }

  const netCashRange = nullableNumberRangeFilter(filter.minNetCash, filter.maxNetCash);
  if (netCashRange) {
    whereAnd.push({ netCash: netCashRange });
  }

  const drawdownRange = nullableNumberRangeFilter(filter.minDrawdownPct, filter.maxDrawdownPct);
  if (drawdownRange) {
    whereAnd.push({ maxDrawdownPct: drawdownRange });
  }

  if (typeof filter.gatePassed === "boolean") {
    whereAnd.push({ gatePassed: filter.gatePassed });
  }

  if (industries.length > 0) {
    whereAnd.push({
      company: {
        industry: {
          in: industries,
        },
      },
    });
  }

  if (query) {
    whereAnd.push({
      OR: [
        { edinetCode: { contains: query, mode: "insensitive" } },
        { company: { name: { contains: query, mode: "insensitive" } } },
        { company: { secCode: { contains: query, mode: "insensitive" } } },
      ],
    });
  }

  const where: Prisma.ScreeningResultWhereInput = whereAnd.length === 1 ? whereAnd[0] : { AND: whereAnd };

  const total = await prisma.screeningResult.count({ where });
  const totalPages = total > 0 ? Math.ceil(total / filter.perPage) : 0;
  const page = totalPages === 0 ? 1 : Math.min(Math.max(1, filter.page), totalPages);
  const skip = (page - 1) * filter.perPage;

  const [rows, facetRows] = await prisma.$transaction([
    prisma.screeningResult.findMany({
      where,
      include: {
        company: true,
      },
      orderBy: buildOrderBy(filter),
      skip,
      take: filter.perPage,
    }),
    prisma.company.findMany({
      where: {
        industry: { not: null },
        screeningResults: {
          some: {
            runId: run.id,
          },
        },
      },
      select: {
        industry: true,
      },
      distinct: ["industry"],
      orderBy: {
        industry: "asc",
      },
    }),
  ]);

  const normalized = rows.map((row) => ({
    ...row,
    criteriaJson: row.criteriaJson as unknown as CriterionEvaluation[],
    metricsJson: row.metricsJson as unknown as ScreeningMetrics,
  }));

  return {
    run,
    pagination: {
      page,
      perPage: filter.perPage,
      total,
      totalPages,
    },
    facets: {
      industries: facetRows
        .map((row) => row.industry)
        .filter((value): value is string => value != null)
        .sort((a, b) => a.localeCompare(b, "ja-JP")),
    },
    data: normalized,
  };
}

