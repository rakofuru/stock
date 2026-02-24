import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnvFile } from "dotenv";
import { Prisma, PrismaClient } from "@prisma/client";

const CHUNK_SIZE_SMALL = 1000;
const CHUNK_SIZE_LARGE = 5000;

for (const file of [".env", ".env.local"]) {
  const path = resolve(process.cwd(), file);
  if (existsSync(path)) {
    loadEnvFile({ path, override: true, quiet: true });
  }
}

function assertEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function toNullableJson(
  value: Prisma.JsonValue | null,
): Prisma.InputJsonValue | Prisma.NullTypes.JsonNull {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
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
  const sourceUrl = assertEnv("SOURCE_DATABASE_URL");
  const targetUrl = assertEnv("DATABASE_URL");

  if (sourceUrl === targetUrl) {
    throw new Error("SOURCE_DATABASE_URL and DATABASE_URL must be different");
  }

  const source = new PrismaClient({
    datasources: { db: { url: sourceUrl } },
  });
  const target = new PrismaClient({
    datasources: { db: { url: targetUrl } },
  });

  try {
    console.log("[migrate] clearing target postgres tables");
    await target.$executeRawUnsafe(`
      TRUNCATE TABLE
        "ScreeningResult",
        "ScreeningRun",
        "CollectionJob",
        "CollectionCycle",
        "PriceDaily",
        "Financial",
        "TextBlock",
        "Company",
        "SamAssumption",
        "RiskKeyword",
        "AppSetting"
      RESTART IDENTITY CASCADE
    `);

    console.log("[migrate] companies");
    const companies = await source.company.findMany({
      orderBy: { edinetCode: "asc" },
    });
    await createManyInChunks(companies, CHUNK_SIZE_SMALL, async (chunk) => {
      await target.company.createMany({
        data: chunk,
      });
    });
    console.log(`[migrate] companies done: ${companies.length}`);

    console.log("[migrate] financials");
    let financialCount = 0;
    let lastFinancialId = 0;
    while (true) {
      const rows = await source.financial.findMany({
        where: { id: { gt: lastFinancialId } },
        orderBy: { id: "asc" },
        take: CHUNK_SIZE_LARGE,
      });
      if (rows.length === 0) {
        break;
      }

      await target.financial.createMany({
        data: rows,
      });

      financialCount += rows.length;
      lastFinancialId = rows[rows.length - 1].id;
      if (financialCount % 50000 === 0) {
        console.log(`[migrate] financials progress: ${financialCount}`);
      }
    }
    console.log(`[migrate] financials done: ${financialCount}`);

    console.log("[migrate] prices_daily");
    let priceCount = 0;
    let lastPriceId = 0;
    while (true) {
      const rows = await source.priceDaily.findMany({
        where: { id: { gt: lastPriceId } },
        orderBy: { id: "asc" },
        take: CHUNK_SIZE_LARGE,
      });
      if (rows.length === 0) {
        break;
      }

      await target.priceDaily.createMany({
        data: rows,
      });

      priceCount += rows.length;
      lastPriceId = rows[rows.length - 1].id;
      if (priceCount % 100000 === 0) {
        console.log(`[migrate] prices_daily progress: ${priceCount}`);
      }
    }
    console.log(`[migrate] prices_daily done: ${priceCount}`);

    console.log("[migrate] collection_cycles");
    const cycles = await source.collectionCycle.findMany();
    await createManyInChunks(cycles, CHUNK_SIZE_SMALL, async (chunk) => {
      await target.collectionCycle.createMany({
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
          prioritySummary: row.prioritySummary,
          targetCodesJson: toNullableJson(row.targetCodesJson),
        })),
      });
    });
    console.log(`[migrate] collection_cycles done: ${cycles.length}`);

    console.log("[migrate] collection_jobs");
    let jobCount = 0;
    let lastJobCreatedAt = new Date(0);
    let lastJobId = "";
    while (true) {
      const rows = await source.collectionJob.findMany({
        where: {
          OR: [
            { createdAt: { gt: lastJobCreatedAt } },
            {
              createdAt: lastJobCreatedAt,
              id: { gt: lastJobId },
            },
          ],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: CHUNK_SIZE_LARGE,
      });
      if (rows.length === 0) {
        break;
      }

      await target.collectionJob.createMany({ data: rows });
      jobCount += rows.length;
      const tail = rows[rows.length - 1];
      lastJobCreatedAt = tail.createdAt;
      lastJobId = tail.id;
    }
    console.log(`[migrate] collection_jobs done: ${jobCount}`);

    console.log("[migrate] screening_runs");
    const runs = await source.screeningRun.findMany();
    await createManyInChunks(runs, CHUNK_SIZE_SMALL, async (chunk) => {
      await target.screeningRun.createMany({
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
    const screeningResults = await source.screeningResult.findMany();
    await createManyInChunks(screeningResults, CHUNK_SIZE_LARGE, async (chunk) => {
      await target.screeningResult.createMany({
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
    const samAssumptions = await source.samAssumption.findMany();
    await target.samAssumption.createMany({
      data: samAssumptions,
    });
    console.log(`[migrate] sam_assumptions done: ${samAssumptions.length}`);

    console.log("[migrate] risk_keywords");
    const riskKeywords = await source.riskKeyword.findMany();
    await target.riskKeyword.createMany({
      data: riskKeywords,
    });
    console.log(`[migrate] risk_keywords done: ${riskKeywords.length}`);

    console.log("[migrate] text_blocks");
    const textBlocks = await source.textBlock.findMany();
    await createManyInChunks(textBlocks, CHUNK_SIZE_LARGE, async (chunk) => {
      await target.textBlock.createMany({
        data: chunk,
      });
    });
    console.log(`[migrate] text_blocks done: ${textBlocks.length}`);

    console.log("[migrate] app_settings");
    const appSettings = await source.appSetting.findMany();
    await target.appSetting.createMany({
      data: appSettings.map((row) => ({
        key: row.key,
        value: row.value as Prisma.InputJsonValue,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      })),
    });
    console.log(`[migrate] app_settings done: ${appSettings.length}`);

    const [targetCompanies, targetFinancials, targetPrices, targetCycles, targetJobs, targetRuns, targetResults] =
      await Promise.all([
        target.company.count(),
        target.financial.count(),
        target.priceDaily.count(),
        target.collectionCycle.count(),
        target.collectionJob.count(),
        target.screeningRun.count(),
        target.screeningResult.count(),
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
          screeningRunCount: targetRuns,
          screeningResultCount: targetResults,
        },
        null,
        2,
      ),
    );
  } finally {
    await source.$disconnect();
    await target.$disconnect();
  }
}

migrate().catch((error) => {
  console.error(error);
  process.exit(1);
});
