import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnvFile } from "dotenv";
import { Prisma, PrismaClient as PostgresClient } from "@prisma/client";
import { PrismaClient as SqliteClient } from "../src/generated/sqlite-client";

const CHUNK_SIZE_SMALL = 1000;
const CHUNK_SIZE_LARGE = 5000;

for (const file of [".env", ".env.local"]) {
  const path = resolve(process.cwd(), file);
  if (existsSync(path)) {
    loadEnvFile({ path, override: true, quiet: true });
  }
}

function toNullableJson(
  value: Prisma.JsonValue | null,
): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function assertEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

async function createManyInChunks<T>(
  rows: T[],
  chunkSize: number,
  insertChunk: (chunk: T[]) => Promise<void>,
) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await insertChunk(chunk);
  }
}

async function migrate() {
  const sqliteUrl = assertEnv("SQLITE_DATABASE_URL");
  const postgresUrl = assertEnv("DATABASE_URL");

  const sqlite = new SqliteClient({
    datasources: {
      db: { url: sqliteUrl },
    },
  });

  const postgres = new PostgresClient({
    datasources: {
      db: { url: postgresUrl },
    },
  });

  try {
    console.log("[migrate] clearing target postgres tables");
    await postgres.$transaction([
      postgres.screeningResult.deleteMany(),
      postgres.screeningRun.deleteMany(),
      postgres.collectionJob.deleteMany(),
      postgres.collectionCycle.deleteMany(),
      postgres.priceDaily.deleteMany(),
      postgres.financial.deleteMany(),
      postgres.textBlock.deleteMany(),
      postgres.company.deleteMany(),
      postgres.samAssumption.deleteMany(),
      postgres.riskKeyword.deleteMany(),
      postgres.appSetting.deleteMany(),
    ]);

    console.log("[migrate] companies");
    const companies = await sqlite.company.findMany({
      select: {
        edinetCode: true,
        secCode: true,
        name: true,
        industry: true,
        accountingStandard: true,
        creditScore: true,
        creditRating: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    await createManyInChunks(companies, CHUNK_SIZE_SMALL, async (chunk) => {
      await postgres.company.createMany({
        data: chunk.map((row) => ({
          edinetCode: row.edinetCode,
          secCode: row.secCode,
          name: row.name,
          industry: row.industry,
          accountingStandard: row.accountingStandard,
          creditScore: row.creditScore,
          creditRating: row.creditRating,
          marketSegment: "UNKNOWN",
          marketProductCategory: null,
          marketPriority: 9,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
      });
    });
    console.log(`[migrate] companies done: ${companies.length}`);

    console.log("[migrate] financials");
    let financialCount = 0;
    let lastFinancialId = 0;
    while (true) {
      const rows = await sqlite.financial.findMany({
        where: { id: { gt: lastFinancialId } },
        orderBy: { id: "asc" },
        take: CHUNK_SIZE_LARGE,
      });
      if (rows.length === 0) {
        break;
      }

      await postgres.financial.createMany({
        data: rows.map((row) => ({
          edinetCode: row.edinetCode,
          fiscalYear: row.fiscalYear,
          revenue: row.revenue,
          operatingIncome: row.operatingIncome,
          ordinaryIncome: row.ordinaryIncome,
          netIncome: row.netIncome,
          totalAssets: row.totalAssets,
          netAssets: row.netAssets,
          eps: row.eps,
          per: row.per,
          roeOfficial: row.roeOfficial,
          equityRatioOfficial: row.equityRatioOfficial,
          bps: row.bps,
          dividendPerShare: row.dividendPerShare,
          cfOperating: row.cfOperating,
          cfInvesting: row.cfInvesting,
          cfFinancing: row.cfFinancing,
          cash: row.cash,
          accountingStandard: row.accountingStandard,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
      });

      financialCount += rows.length;
      lastFinancialId = rows[rows.length - 1].id;
    }
    console.log(`[migrate] financials done: ${financialCount}`);

    console.log("[migrate] prices_daily");
    let priceCount = 0;
    let lastPriceId = 0;
    while (true) {
      const rows = await sqlite.priceDaily.findMany({
        where: { id: { gt: lastPriceId } },
        orderBy: { id: "asc" },
        take: CHUNK_SIZE_LARGE,
      });
      if (rows.length === 0) {
        break;
      }

      await postgres.priceDaily.createMany({
        data: rows.map((row) => ({
          edinetCode: row.edinetCode,
          date: row.date,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
        })),
      });

      priceCount += rows.length;
      lastPriceId = rows[rows.length - 1].id;
    }
    console.log(`[migrate] prices_daily done: ${priceCount}`);

    console.log("[migrate] collection_cycles");
    const cycles = await sqlite.collectionCycle.findMany({
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
      },
    });
    await createManyInChunks(cycles, CHUNK_SIZE_SMALL, async (chunk) => {
      await postgres.collectionCycle.createMany({
        data: chunk.map((row) => ({
          id: row.id,
          status: row.status,
          startedAt: row.startedAt,
          endedAt: row.endedAt,
          cursor: row.cursor,
          totalCompanies: row.totalCompanies,
          processedCount: row.processedCount,
          dailyLimit: row.dailyLimit,
          lastError: row.lastError,
          prioritySummary: null,
          targetCodesJson: Prisma.JsonNull,
        })),
      });
    });
    console.log(`[migrate] collection_cycles done: ${cycles.length}`);

    console.log("[migrate] collection_jobs");
    const jobs = await sqlite.collectionJob.findMany();
    await createManyInChunks(jobs, CHUNK_SIZE_LARGE, async (chunk) => {
      await postgres.collectionJob.createMany({
        data: chunk.map((row) => ({
          id: row.id,
          cycleId: row.cycleId,
          edinetCode: row.edinetCode,
          jobType: row.jobType,
          status: row.status,
          requestSource: row.requestSource,
          attempt: row.attempt,
          httpStatus: row.httpStatus,
          errorMessage: row.errorMessage,
          createdAt: row.createdAt,
        })),
      });
    });
    console.log(`[migrate] collection_jobs done: ${jobs.length}`);

    console.log("[migrate] screening_runs");
    const runs = await sqlite.screeningRun.findMany();
    await createManyInChunks(runs, CHUNK_SIZE_SMALL, async (chunk) => {
      await postgres.screeningRun.createMany({
        data: chunk.map((row) => ({
          id: row.id,
          status: row.status,
          startedAt: row.startedAt,
          endedAt: row.endedAt,
          weightsJson: toNullableJson(row.weightsJson),
          summaryJson: toNullableJson(row.summaryJson),
        })),
      });
    });
    console.log(`[migrate] screening_runs done: ${runs.length}`);

    console.log("[migrate] screening_results");
    const screeningResults = await sqlite.screeningResult.findMany();
    await createManyInChunks(screeningResults, CHUNK_SIZE_LARGE, async (chunk) => {
      await postgres.screeningResult.createMany({
        data: chunk.map((row) => ({
          id: row.id,
          runId: row.runId,
          edinetCode: row.edinetCode,
          gatePassed: row.gatePassed,
          score: row.score,
          coverage: row.coverage,
          pendingCount: row.pendingCount,
          criteriaJson: row.criteriaJson as Prisma.InputJsonValue,
          metricsJson: row.metricsJson as Prisma.InputJsonValue,
          createdAt: row.createdAt,
        })),
      });
    });
    console.log(`[migrate] screening_results done: ${screeningResults.length}`);

    console.log("[migrate] sam_assumptions");
    const samAssumptions = await sqlite.samAssumption.findMany();
    await postgres.samAssumption.createMany({
      data: samAssumptions.map((row) => ({
        id: row.id,
        industry: row.industry,
        sam: row.sam,
        assumedShare: row.assumedShare,
        futureMultiple: row.futureMultiple,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    });
    console.log(`[migrate] sam_assumptions done: ${samAssumptions.length}`);

    console.log("[migrate] risk_keywords");
    const riskKeywords = await sqlite.riskKeyword.findMany();
    await postgres.riskKeyword.createMany({
      data: riskKeywords.map((row) => ({
        id: row.id,
        keyword: row.keyword,
        enabled: row.enabled,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    });
    console.log(`[migrate] risk_keywords done: ${riskKeywords.length}`);

    console.log("[migrate] text_blocks");
    const textBlocks = await sqlite.textBlock.findMany();
    await createManyInChunks(textBlocks, CHUNK_SIZE_LARGE, async (chunk) => {
      await postgres.textBlock.createMany({
        data: chunk.map((row) => ({
          id: row.id,
          edinetCode: row.edinetCode,
          fiscalYear: row.fiscalYear,
          section: row.section,
          text: row.text,
          fetchedAt: row.fetchedAt,
        })),
      });
    });
    console.log(`[migrate] text_blocks done: ${textBlocks.length}`);

    console.log("[migrate] app_settings");
    const appSettings = await sqlite.appSetting.findMany();
    await postgres.appSetting.createMany({
      data: appSettings.map((row) => ({
        key: row.key,
        value: row.value as Prisma.InputJsonValue,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    });
    console.log(`[migrate] app_settings done: ${appSettings.length}`);

    const [targetCompanies, targetFinancials, targetPrices, targetCycles, targetJobs] = await Promise.all([
      postgres.company.count(),
      postgres.financial.count(),
      postgres.priceDaily.count(),
      postgres.collectionCycle.count(),
      postgres.collectionJob.count(),
    ]);

    console.log("[migrate] completed");
    console.log(
      JSON.stringify(
        {
          companyCount: targetCompanies,
          financialCount: targetFinancials,
          priceCount: targetPrices,
          cycleCount: targetCycles,
          collectionJobCount: targetJobs,
        },
        null,
        2,
      ),
    );
  } finally {
    await sqlite.$disconnect();
    await postgres.$disconnect();
  }
}

migrate().catch((error) => {
  console.error(error);
  process.exit(1);
});
