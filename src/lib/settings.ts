import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  APP_SETTING_KEYS,
  DEFAULT_RISK_KEYWORDS,
  DEFAULT_SAM_ASSUMPTIONS,
  DEFAULT_WEIGHTS,
} from "@/lib/defaults";
import { prisma } from "@/lib/prisma";
import type { SamAssumptionInput, ScreeningWeights } from "@/lib/types";

const weightsSchema = z.object({
  priceToSalesCheap: z.number().min(0).max(5),
  netCashVsMarketCap: z.number().min(0).max(5),
  samUpside: z.number().min(0).max(5),
  perReasonable: z.number().min(0).max(5),
  pbrUnderOne: z.number().min(0).max(5),
  cashFlowHealth: z.number().min(0).max(5),
  highPriceAvoidance: z.number().min(0).max(5),
  growthConsistency: z.number().min(0).max(5),
  equityStrengthBonus: z.number().min(0).max(5),
  foreignOwnershipCheck: z.number().min(0).max(5),
  textRiskCheck: z.number().min(0).max(5),
});

const samAssumptionSchema = z.object({
  industry: z.string().min(1),
  sam: z.number().positive(),
  assumedShare: z.number().min(0).max(1),
  futureMultiple: z.number().positive(),
});

const riskKeywordSchema = z.object({
  keyword: z.string().min(1),
  enabled: z.boolean(),
});

const samRecalculateSchema = z.object({
  revenueMultiplier: z.number().positive().max(100).default(10),
  roundUnit: z.number().positive().default(1e8),
});

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }

  return (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function ensureDefaultSettings() {
  const [weightSetting, samCount, keywordCount] = await Promise.all([
    prisma.appSetting.findUnique({ where: { key: APP_SETTING_KEYS.weights } }),
    prisma.samAssumption.count(),
    prisma.riskKeyword.count(),
  ]);

  if (!weightSetting) {
    await prisma.appSetting.create({
      data: {
        key: APP_SETTING_KEYS.weights,
        value: DEFAULT_WEIGHTS as unknown as Prisma.InputJsonValue,
      },
    });
  }

  if (samCount === 0) {
    await prisma.samAssumption.createMany({ data: DEFAULT_SAM_ASSUMPTIONS });
  }

  if (keywordCount === 0) {
    await prisma.riskKeyword.createMany({
      data: DEFAULT_RISK_KEYWORDS.map((keyword) => ({ keyword, enabled: true })),
    });
  }
}

export async function getWeights(): Promise<ScreeningWeights> {
  await ensureDefaultSettings();
  const setting = await prisma.appSetting.findUnique({ where: { key: APP_SETTING_KEYS.weights } });
  if (!setting) {
    return DEFAULT_WEIGHTS;
  }

  const parsed = weightsSchema.safeParse(setting.value);
  if (!parsed.success) {
    return DEFAULT_WEIGHTS;
  }

  return parsed.data;
}

export async function updateWeights(input: unknown): Promise<ScreeningWeights> {
  const parsed = weightsSchema.parse(input);

  await prisma.appSetting.upsert({
    where: { key: APP_SETTING_KEYS.weights },
    create: {
      key: APP_SETTING_KEYS.weights,
      value: parsed as Prisma.InputJsonValue,
    },
    update: {
      value: parsed as Prisma.InputJsonValue,
    },
  });

  return parsed;
}

export async function getSamAssumptions() {
  await ensureDefaultSettings();
  return prisma.samAssumption.findMany({ orderBy: { industry: "asc" } });
}

export async function updateSamAssumptions(input: unknown) {
  const payload = z.array(samAssumptionSchema).min(1).parse(input);

  await prisma.$transaction(
    payload.map((item) =>
      prisma.samAssumption.upsert({
        where: { industry: item.industry },
        create: item,
        update: {
          sam: item.sam,
          assumedShare: item.assumedShare,
          futureMultiple: item.futureMultiple,
        },
      }),
    ),
  );

  return prisma.samAssumption.findMany({ orderBy: { industry: "asc" } });
}

export async function recalculateSamFromMedianRevenue(input: unknown) {
  await ensureDefaultSettings();
  const options = samRecalculateSchema.parse(input ?? {});

  const [existingSamRows, financialRows] = await Promise.all([
    prisma.samAssumption.findMany(),
    prisma.financial.findMany({
      where: { revenue: { not: null } },
      orderBy: [{ edinetCode: "asc" }, { fiscalYear: "desc" }],
      select: {
        edinetCode: true,
        revenue: true,
        company: {
          select: { industry: true },
        },
      },
    }),
  ]);

  const latestRevenueByCode = new Map<string, { industry: string; revenue: number }>();
  for (const row of financialRows) {
    if (latestRevenueByCode.has(row.edinetCode)) {
      continue;
    }

    const industry = row.company.industry?.trim();
    const revenue = row.revenue;

    if (!industry || revenue == null || revenue <= 0) {
      continue;
    }

    latestRevenueByCode.set(row.edinetCode, { industry, revenue });
  }

  const revenuesByIndustry = new Map<string, number[]>();
  for (const { industry, revenue } of latestRevenueByCode.values()) {
    const list = revenuesByIndustry.get(industry) ?? [];
    list.push(revenue);
    revenuesByIndustry.set(industry, list);
  }

  const existingByIndustry = new Map(existingSamRows.map((row) => [row.industry, row]));
  const defaultsByIndustry = new Map(DEFAULT_SAM_ASSUMPTIONS.map((row) => [row.industry, row]));

  const statements: Prisma.PrismaPromise<unknown>[] = [];
  let updatedIndustries = 0;

  for (const [industry, revenues] of revenuesByIndustry.entries()) {
    const revenueMedian = median(revenues);
    if (revenueMedian == null || revenueMedian <= 0) {
      continue;
    }

    const computedSamRaw = revenueMedian * options.revenueMultiplier;
    const computedSam = Math.max(
      options.roundUnit,
      Math.round(computedSamRaw / options.roundUnit) * options.roundUnit,
    );

    const existing = existingByIndustry.get(industry);
    const fallback = defaultsByIndustry.get(industry);

    statements.push(
      prisma.samAssumption.upsert({
        where: { industry },
        create: {
          industry,
          sam: computedSam,
          assumedShare: existing?.assumedShare ?? fallback?.assumedShare ?? 0.02,
          futureMultiple: existing?.futureMultiple ?? fallback?.futureMultiple ?? 1.4,
        },
        update: {
          sam: computedSam,
        },
      }),
    );
    updatedIndustries += 1;
  }

  if (statements.length > 0) {
    await prisma.$transaction(statements);
  }

  const data = await prisma.samAssumption.findMany({ orderBy: { industry: "asc" } });

  return {
    data,
    summary: {
      method: "median_latest_revenue_x_multiplier",
      revenueMultiplier: options.revenueMultiplier,
      roundUnit: options.roundUnit,
      sampledCompanies: latestRevenueByCode.size,
      updatedIndustries,
    },
  };
}

export async function getRiskKeywords() {
  await ensureDefaultSettings();
  return prisma.riskKeyword.findMany({ orderBy: { keyword: "asc" } });
}

export async function updateRiskKeywords(input: unknown) {
  const payload = z.array(riskKeywordSchema).min(1).parse(input);

  await prisma.$transaction(
    payload.map((item) =>
      prisma.riskKeyword.upsert({
        where: { keyword: item.keyword },
        create: item,
        update: { enabled: item.enabled },
      }),
    ),
  );

  return prisma.riskKeyword.findMany({ orderBy: { keyword: "asc" } });
}

export function validateSamAssumptions(input: unknown): SamAssumptionInput[] {
  return z.array(samAssumptionSchema).parse(input);
}


