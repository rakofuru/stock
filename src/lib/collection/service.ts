import { CollectionCycleStatus, JobStatus } from "@prisma/client";
import { fetchCompanies, fetchFinancials, EdinetApiError, EdinetRateLimitError } from "@/lib/clients/edinet";
import { fetchJpxListingMap, normalizeSecCode } from "@/lib/clients/jpx";
import { fetchStooqDaily, toStooqSymbol } from "@/lib/clients/stooq";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { ensureDefaultSettings } from "@/lib/settings";
import { getJstDayBounds } from "@/lib/time";
import type { CollectionRunSummary } from "@/lib/types";

const RESERVED_BUFFER = 20;
const MONITOR_WINDOW_HOURS = 24;
const STALL_THRESHOLD_MS = 3 * 60 * 60 * 1000;

interface RunCollectionOptions {
  maxCompanies?: number;
  ignoreLocalQuota?: boolean;
}

interface ActiveCycle {
  id: string;
  totalCompanies: number;
  cursor: number;
  dailyLimit: number;
  targetCodes: string[] | null;
}

interface JpxPriorityInfo {
  marketSegment: string;
  marketPriority: number;
  marketProductCategory: string;
}

function toNullableNumber(value: number | null | undefined): number | null {
  return value == null || Number.isNaN(value) ? null : value;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  if (!value.every((item) => typeof item === "string")) {
    return null;
  }
  return value;
}

async function createJobLog(input: {
  cycleId: string;
  edinetCode?: string;
  jobType: "MASTER_LIST" | "FINANCIALS" | "PRICE" | "TEXT_BLOCKS";
  status: JobStatus;
  requestSource: "EDINET" | "STOOQ";
  attempt?: number;
  httpStatus?: number;
  errorMessage?: string;
}) {
  await prisma.collectionJob.create({
    data: {
      cycleId: input.cycleId,
      edinetCode: input.edinetCode,
      jobType: input.jobType,
      status: input.status,
      requestSource: input.requestSource,
      attempt: input.attempt ?? 1,
      httpStatus: input.httpStatus,
      errorMessage: input.errorMessage,
    },
  });
}

async function upsertCompanyMaster() {
  let jpxListingMap = new Map<string, JpxPriorityInfo>();

  try {
    jpxListingMap = await fetchJpxListingMap();
  } catch (error) {
    console.warn(
      `[collection] JPX listing map fetch failed. Falling back to UNKNOWN segment. ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
  }

  const companies = await fetchCompanies(5000);

  for (const company of companies) {
    const code4 = normalizeSecCode(company.sec_code);
    const listing = code4 ? jpxListingMap.get(code4) : undefined;

    await prisma.company.upsert({
      where: { edinetCode: company.edinet_code },
      create: {
        edinetCode: company.edinet_code,
        secCode: company.sec_code,
        name: company.name,
        industry: company.industry,
        accountingStandard: company.accounting_standard,
        creditScore: company.credit_score,
        creditRating: company.credit_rating,
        marketSegment: listing?.marketSegment ?? "UNKNOWN",
        marketPriority: listing?.marketPriority ?? 9,
        marketProductCategory: listing?.marketProductCategory ?? null,
      },
      update: {
        secCode: company.sec_code,
        name: company.name,
        industry: company.industry,
        accountingStandard: company.accounting_standard,
        creditScore: company.credit_score,
        creditRating: company.credit_rating,
        marketSegment: listing?.marketSegment ?? "UNKNOWN",
        marketPriority: listing?.marketPriority ?? 9,
        marketProductCategory: listing?.marketProductCategory ?? null,
      },
    });
  }

  return companies.length;
}

async function syncMarketPriorityFromJpx() {
  let jpxListingMap = new Map<string, JpxPriorityInfo>();
  try {
    jpxListingMap = await fetchJpxListingMap();
  } catch (error) {
    console.warn(
      `[collection] JPX listing map refresh failed. Keep existing priorities. ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    );
    return;
  }

  const companies = await prisma.company.findMany({
    select: {
      edinetCode: true,
      secCode: true,
    },
  });

  for (const company of companies) {
    const code4 = normalizeSecCode(company.secCode);
    const listing = code4 ? jpxListingMap.get(code4) : undefined;

    await prisma.company.update({
      where: { edinetCode: company.edinetCode },
      data: {
        marketSegment: listing?.marketSegment ?? "UNKNOWN",
        marketPriority: listing?.marketPriority ?? 9,
        marketProductCategory: listing?.marketProductCategory ?? null,
      },
    });
  }
}

async function buildPriorityTargets() {
  const companies = await prisma.company.findMany({
    select: {
      edinetCode: true,
      marketSegment: true,
    },
    orderBy: [{ marketPriority: "asc" }, { edinetCode: "asc" }],
  });
  const withFinancialRows = await prisma.financial.findMany({
    select: { edinetCode: true },
    distinct: ["edinetCode"],
  });
  const withFinancialSet = new Set(withFinancialRows.map((row) => row.edinetCode));

  const counters = {
    PRIME: 0,
    STANDARD: 0,
    GROWTH: 0,
    OTHER: 0,
    UNKNOWN: 0,
  };
  const missingFinancialCodes: string[] = [];
  const existingFinancialCodes: string[] = [];

  for (const company of companies) {
    switch (company.marketSegment) {
      case "PRIME":
        counters.PRIME += 1;
        break;
      case "STANDARD":
        counters.STANDARD += 1;
        break;
      case "GROWTH":
        counters.GROWTH += 1;
        break;
      case "OTHER":
        counters.OTHER += 1;
        break;
      default:
        counters.UNKNOWN += 1;
        break;
    }

    if (withFinancialSet.has(company.edinetCode)) {
      existingFinancialCodes.push(company.edinetCode);
    } else {
      missingFinancialCodes.push(company.edinetCode);
    }
  }

  const targetCodes = [...missingFinancialCodes, ...existingFinancialCodes];

  return {
    targetCodes,
    prioritySummary: `PRIME:${counters.PRIME} / STANDARD:${counters.STANDARD} / GROWTH:${counters.GROWTH} / OTHER:${counters.OTHER} / UNKNOWN:${counters.UNKNOWN} / MISSING_FIN:${missingFinancialCodes.length}`,
  };
}

async function createNewCycle(): Promise<ActiveCycle> {
  await upsertCompanyMaster();
  const { targetCodes, prioritySummary } = await buildPriorityTargets();

  const cycle = await prisma.collectionCycle.create({
    data: {
      status: "RUNNING",
      cursor: 0,
      totalCompanies: targetCodes.length,
      processedCount: 0,
      dailyLimit: env.COLLECTION_DAILY_LIMIT,
      targetCodesJson: targetCodes,
      prioritySummary,
    },
    select: {
      id: true,
      totalCompanies: true,
      cursor: true,
      dailyLimit: true,
      targetCodesJson: true,
    },
  });

  await createJobLog({
    cycleId: cycle.id,
    jobType: "MASTER_LIST",
    requestSource: "EDINET",
    status: "SUCCESS",
  });

  return {
    id: cycle.id,
    totalCompanies: cycle.totalCompanies,
    cursor: cycle.cursor,
    dailyLimit: cycle.dailyLimit,
    targetCodes: asStringArray(cycle.targetCodesJson),
  };
}

async function hydrateLegacyCycleTargets(cycleId: string, dailyLimit: number): Promise<ActiveCycle> {
  await syncMarketPriorityFromJpx();
  const { targetCodes, prioritySummary } = await buildPriorityTargets();
  const processedRows = await prisma.collectionJob.findMany({
    where: {
      cycleId,
      jobType: "FINANCIALS",
      edinetCode: { not: null },
    },
    select: { edinetCode: true },
  });

  const processedSet = new Set(
    processedRows
      .map((row) => row.edinetCode)
      .filter((code): code is string => typeof code === "string"),
  );

  const processedCodes = targetCodes.filter((code) => processedSet.has(code));
  const pendingCodes = targetCodes.filter((code) => !processedSet.has(code));
  const mergedCodes = [...processedCodes, ...pendingCodes];
  const cursor = Math.min(mergedCodes.length, processedCodes.length);

  await prisma.collectionCycle.update({
    where: { id: cycleId },
    data: {
      targetCodesJson: mergedCodes,
      prioritySummary,
      totalCompanies: mergedCodes.length,
      cursor,
    },
  });

  return {
    id: cycleId,
    totalCompanies: mergedCodes.length,
    cursor,
    dailyLimit,
    targetCodes: mergedCodes,
  };
}

async function resolveActiveCycle(): Promise<ActiveCycle> {
  const existing = await prisma.collectionCycle.findFirst({
    orderBy: { startedAt: "desc" },
  });

  if (!existing || existing.status === "COMPLETED" || existing.status === "FAILED") {
    return createNewCycle();
  }

  if (existing.cursor >= existing.totalCompanies) {
    await prisma.collectionCycle.update({
      where: { id: existing.id },
      data: {
        status: "COMPLETED",
        endedAt: new Date(),
      },
    });
    return createNewCycle();
  }

  if (existing.status === "PAUSED") {
    await prisma.collectionCycle.update({
      where: { id: existing.id },
      data: {
        status: "RUNNING",
        lastError: null,
      },
    });
  }

  let effectiveDailyLimit = existing.dailyLimit;
  if (existing.dailyLimit !== env.COLLECTION_DAILY_LIMIT) {
    await prisma.collectionCycle.update({
      where: { id: existing.id },
      data: {
        dailyLimit: env.COLLECTION_DAILY_LIMIT,
      },
    });
    effectiveDailyLimit = env.COLLECTION_DAILY_LIMIT;
  }

  const existingTargets = asStringArray(existing.targetCodesJson);
  if (!existingTargets || existingTargets.length !== existing.totalCompanies) {
    return hydrateLegacyCycleTargets(existing.id, effectiveDailyLimit);
  }

  return {
    id: existing.id,
    totalCompanies: existing.totalCompanies,
    cursor: existing.cursor,
    dailyLimit: effectiveDailyLimit,
    targetCodes: existingTargets,
  };
}

async function countTodayFinancialRequests() {
  const { start, end } = getJstDayBounds();
  return prisma.collectionJob.count({
    where: {
      requestSource: "EDINET",
      jobType: "FINANCIALS",
      createdAt: {
        gte: start,
        lt: end,
      },
    },
  });
}

async function syncFinancialSeries(cycleId: string, edinetCode: string) {
  try {
    const series = await fetchFinancials(edinetCode, 5);

    await prisma.$transaction(async (tx) => {
      for (const row of series) {
        await tx.financial.upsert({
          where: {
            edinetCode_fiscalYear: {
              edinetCode,
              fiscalYear: row.fiscal_year,
            },
          },
          create: {
            edinetCode,
            fiscalYear: row.fiscal_year,
            revenue: toNullableNumber(row.revenue),
            operatingIncome: toNullableNumber(row.operating_income),
            ordinaryIncome: toNullableNumber(row.ordinary_income),
            netIncome: toNullableNumber(row.net_income),
            totalAssets: toNullableNumber(row.total_assets),
            netAssets: toNullableNumber(row.net_assets),
            eps: toNullableNumber(row.eps),
            per: toNullableNumber(row.per),
            roeOfficial: toNullableNumber(row.roe_official),
            equityRatioOfficial: toNullableNumber(row.equity_ratio_official),
            bps: toNullableNumber(row.bps),
            dividendPerShare: toNullableNumber(row.dividend_per_share),
            cfOperating: toNullableNumber(row.cf_operating),
            cfInvesting: toNullableNumber(row.cf_investing),
            cfFinancing: toNullableNumber(row.cf_financing),
            cash: toNullableNumber(row.cash),
            accountingStandard: row.accounting_standard ?? null,
          },
          update: {
            revenue: toNullableNumber(row.revenue),
            operatingIncome: toNullableNumber(row.operating_income),
            ordinaryIncome: toNullableNumber(row.ordinary_income),
            netIncome: toNullableNumber(row.net_income),
            totalAssets: toNullableNumber(row.total_assets),
            netAssets: toNullableNumber(row.net_assets),
            eps: toNullableNumber(row.eps),
            per: toNullableNumber(row.per),
            roeOfficial: toNullableNumber(row.roe_official),
            equityRatioOfficial: toNullableNumber(row.equity_ratio_official),
            bps: toNullableNumber(row.bps),
            dividendPerShare: toNullableNumber(row.dividend_per_share),
            cfOperating: toNullableNumber(row.cf_operating),
            cfInvesting: toNullableNumber(row.cf_investing),
            cfFinancing: toNullableNumber(row.cf_financing),
            cash: toNullableNumber(row.cash),
            accountingStandard: row.accounting_standard ?? null,
          },
        });
      }
    });

    await createJobLog({
      cycleId,
      edinetCode,
      jobType: "FINANCIALS",
      requestSource: "EDINET",
      status: "SUCCESS",
    });
  } catch (error) {
    if (error instanceof EdinetRateLimitError) {
      await createJobLog({
        cycleId,
        edinetCode,
        jobType: "FINANCIALS",
        requestSource: "EDINET",
        status: "FAILED",
        httpStatus: 429,
        errorMessage: error.message,
      });
      throw error;
    }

    const httpStatus = error instanceof EdinetApiError ? error.status : undefined;
    await createJobLog({
      cycleId,
      edinetCode,
      jobType: "FINANCIALS",
      requestSource: "EDINET",
      status: "FAILED",
      httpStatus,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

async function syncPriceHistory(cycleId: string, edinetCode: string, secCode: string | null) {
  const symbol = toStooqSymbol(secCode);

  if (!symbol) {
    await createJobLog({
      cycleId,
      edinetCode,
      jobType: "PRICE",
      requestSource: "STOOQ",
      status: "SKIPPED",
      errorMessage: "No valid sec_code for Stooq symbol conversion",
    });
    return;
  }

  try {
    const allRows = await fetchStooqDaily(symbol);
    const fiveYearsAgo = new Date();
    fiveYearsAgo.setUTCFullYear(fiveYearsAgo.getUTCFullYear() - 5);

    const rows = allRows.filter((row) => row.date >= fiveYearsAgo);

    if (rows.length === 0) {
      await createJobLog({
        cycleId,
        edinetCode,
        jobType: "PRICE",
        requestSource: "STOOQ",
        status: "SKIPPED",
        errorMessage: `No recent Stooq rows for ${symbol}`,
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      await tx.priceDaily.deleteMany({ where: { edinetCode } });
      await tx.priceDaily.createMany({
        data: rows.map((row) => ({
          edinetCode,
          date: row.date,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume,
        })),
      });
    });

    await createJobLog({
      cycleId,
      edinetCode,
      jobType: "PRICE",
      requestSource: "STOOQ",
      status: "SUCCESS",
    });
  } catch (error) {
    await createJobLog({
      cycleId,
      edinetCode,
      jobType: "PRICE",
      requestSource: "STOOQ",
      status: "FAILED",
      errorMessage: error instanceof Error ? error.message : "Unknown Stooq error",
    });
  }
}

export async function runCollectionCycle(options: RunCollectionOptions = {}): Promise<CollectionRunSummary> {
  await ensureDefaultSettings();

  const cycle = await resolveActiveCycle();
  const todayCount = await countTodayFinancialRequests();
  const localRemainingToday = Math.max(0, cycle.dailyLimit - todayCount - RESERVED_BUFFER);
  const availableToday = options.ignoreLocalQuota
    ? Math.max(0, cycle.totalCompanies - cycle.cursor)
    : localRemainingToday;

  if (availableToday <= 0 && !options.ignoreLocalQuota) {
    await prisma.collectionCycle.update({
      where: { id: cycle.id },
      data: {
        status: "PAUSED",
        lastError: "Daily quota reached. Resume after next JST day.",
      },
    });

    return {
      cycleId: cycle.id,
      status: "PAUSED",
      processedThisRun: 0,
      cursor: cycle.cursor,
      totalCompanies: cycle.totalCompanies,
      remainingToday: 0,
      message: "Daily quota reached.",
    };
  }

  const maxCompanies = options.maxCompanies ?? cycle.dailyLimit;
  const take = Math.min(maxCompanies, availableToday, cycle.totalCompanies - cycle.cursor);

  let companies: Array<{ edinetCode: string; secCode: string | null }> = [];

  if (cycle.targetCodes && cycle.targetCodes.length === cycle.totalCompanies) {
    const targetCodes = cycle.targetCodes.slice(cycle.cursor, cycle.cursor + take);
    const rows = await prisma.company.findMany({
      where: {
        edinetCode: {
          in: targetCodes,
        },
      },
      select: {
        edinetCode: true,
        secCode: true,
      },
    });

    const rowMap = new Map(rows.map((row) => [row.edinetCode, row]));
    companies = targetCodes
      .map((code) => rowMap.get(code))
      .filter((row): row is { edinetCode: string; secCode: string | null } => row != null);
  } else {
    companies = await prisma.company.findMany({
      orderBy: { edinetCode: "asc" },
      skip: cycle.cursor,
      take,
      select: {
        edinetCode: true,
        secCode: true,
      },
    });
  }

  let cursor = cycle.cursor;
  let processed = 0;
  let status: CollectionCycleStatus = "RUNNING";
  let message: string | undefined;

  for (const company of companies) {
    try {
      await syncFinancialSeries(cycle.id, company.edinetCode);
      await syncPriceHistory(cycle.id, company.edinetCode, company.secCode);
    } catch (error) {
      if (error instanceof EdinetRateLimitError) {
        status = "PAUSED";
        message = "EDINET rate limit reached during execution.";
        break;
      }
      status = "RUNNING";
    }

    cursor += 1;
    processed += 1;
  }

  if (cursor >= cycle.totalCompanies) {
    status = "COMPLETED";
    message = "Collection cycle completed.";
  }

  await prisma.collectionCycle.update({
    where: { id: cycle.id },
    data: {
      cursor,
      processedCount: {
        increment: processed,
      },
      status,
      endedAt: status === "COMPLETED" ? new Date() : null,
      lastError: status === "PAUSED" ? message ?? "Paused." : null,
    },
  });

  return {
    cycleId: cycle.id,
    status,
    processedThisRun: processed,
    cursor,
    totalCompanies: cycle.totalCompanies,
    remainingToday: Math.max(0, localRemainingToday - processed),
    message,
  };
}

export async function getCollectionStatus() {
  const cycle = await prisma.collectionCycle.findFirst({
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      status: true,
      startedAt: true,
      endedAt: true,
      cursor: true,
      totalCompanies: true,
      processedCount: true,
      dailyLimit: true,
      lastError: true,
      prioritySummary: true,
    },
  });

  const { end: resetAt } = getJstDayBounds();
  const monitorWindowStart = new Date(Date.now() - MONITOR_WINDOW_HOURS * 60 * 60 * 1000);
  const [todayCount, failures, failuresInWindow, rateLimitInWindow, latestFailure, latestSuccessFinancial] =
    await Promise.all([
      countTodayFinancialRequests(),
      prisma.collectionJob.findMany({
        where: { status: "FAILED" },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          createdAt: true,
          edinetCode: true,
          jobType: true,
          errorMessage: true,
          httpStatus: true,
        },
      }),
      prisma.collectionJob.count({
        where: {
          status: "FAILED",
          createdAt: {
            gte: monitorWindowStart,
          },
        },
      }),
      prisma.collectionJob.count({
        where: {
          status: "FAILED",
          httpStatus: 429,
          createdAt: {
            gte: monitorWindowStart,
          },
        },
      }),
      prisma.collectionJob.findFirst({
        where: {
          status: "FAILED",
        },
        orderBy: {
          createdAt: "desc",
        },
        select: {
          createdAt: true,
          edinetCode: true,
          jobType: true,
          httpStatus: true,
          errorMessage: true,
        },
      }),
      prisma.collectionJob.findFirst({
        where: {
          status: "SUCCESS",
          jobType: "FINANCIALS",
        },
        orderBy: {
          createdAt: "desc",
        },
        select: {
          createdAt: true,
          edinetCode: true,
        },
      }),
    ]);

  const remainingToday = cycle ? Math.max(0, cycle.dailyLimit - todayCount - RESERVED_BUFFER) : env.COLLECTION_DAILY_LIMIT;
  const latestSuccessfulAt = latestSuccessFinancial?.createdAt ?? null;
  const staleReference = latestSuccessfulAt ?? cycle?.startedAt ?? null;
  const stalled = cycle?.status === "RUNNING" && staleReference != null ? Date.now() - staleReference.getTime() > STALL_THRESHOLD_MS : false;

  let monitorLevel: "OK" | "WARN" | "ERROR" = "OK";
  let monitorMessage = "収集ジョブは正常です。";

  if (!cycle) {
    monitorLevel = "WARN";
    monitorMessage = "収集サイクルが未開始です。";
  } else if (cycle.status === "FAILED" || stalled) {
    monitorLevel = "ERROR";
    monitorMessage = stalled ? "収集が停止している可能性があります。ログを確認して再開してください。" : "収集サイクルが失敗しています。";
  } else if (cycle.status === "PAUSED") {
    monitorLevel = "WARN";
    monitorMessage = "収集は一時停止中です。";
  } else if (rateLimitInWindow > 0) {
    monitorLevel = "WARN";
    monitorMessage = "直近24時間で429が発生しています。次回リセット後に再開してください。";
  } else if (failuresInWindow > 0) {
    monitorLevel = "WARN";
    monitorMessage = "直近24時間に失敗ジョブがあります。";
  }

  if (!cycle) {
    return {
      cycle: null,
      progressPercent: 0,
      todayRequests: todayCount,
      remainingToday,
      remainingCompanies: 0,
      dailyProcessCapacity: Math.max(1, env.COLLECTION_DAILY_LIMIT - RESERVED_BUFFER),
      estimatedDaysLeft: 0,
      estimatedCompletionDayJst: getJstDayBounds().dayKey,
      nextResetAt: resetAt.toISOString(),
      failures,
      monitor: {
        level: monitorLevel,
        message: monitorMessage,
        keyCount: env.EDINET_API_KEYS.length,
        stalled,
        failuresInWindow,
        rateLimitInWindow,
        latestSuccessfulAt: latestSuccessfulAt?.toISOString() ?? null,
        latestFailure: latestFailure
          ? {
              createdAt: latestFailure.createdAt.toISOString(),
              edinetCode: latestFailure.edinetCode,
              jobType: latestFailure.jobType,
              httpStatus: latestFailure.httpStatus,
              errorMessage: latestFailure.errorMessage,
            }
          : null,
      },
    };
  }

  const remainingCompanies = Math.max(0, cycle.totalCompanies - cycle.cursor);
  const dailyProcessCapacity = Math.max(1, cycle.dailyLimit - RESERVED_BUFFER);
  const remainingAfterToday = Math.max(0, remainingCompanies - remainingToday);
  const estimatedDaysLeft = Math.ceil(remainingAfterToday / dailyProcessCapacity);
  const completionReference = new Date(Date.now() + estimatedDaysLeft * 24 * 60 * 60 * 1000);
  const estimatedCompletionDayJst = getJstDayBounds(completionReference).dayKey;
  const progressPercent = cycle.totalCompanies > 0 ? (cycle.cursor / cycle.totalCompanies) * 100 : 0;

  return {
    cycle,
    progressPercent,
    todayRequests: todayCount,
    remainingToday,
    remainingCompanies,
    dailyProcessCapacity,
    estimatedDaysLeft,
    estimatedCompletionDayJst,
    nextResetAt: resetAt.toISOString(),
    failures,
    monitor: {
      level: monitorLevel,
      message: monitorMessage,
      keyCount: env.EDINET_API_KEYS.length,
      stalled,
      failuresInWindow,
      rateLimitInWindow,
      latestSuccessfulAt: latestSuccessfulAt?.toISOString() ?? null,
      latestFailure: latestFailure
        ? {
            createdAt: latestFailure.createdAt.toISOString(),
            edinetCode: latestFailure.edinetCode,
            jobType: latestFailure.jobType,
            httpStatus: latestFailure.httpStatus,
            errorMessage: latestFailure.errorMessage,
          }
        : null,
    },
  };
}
