import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/clients/edinet", () => ({
  fetchCompanies: vi.fn(async () => [
    {
      edinet_code: "E00001",
      sec_code: "11110",
      name: "A社",
      industry: "情報・通信業",
      accounting_standard: "JP",
      credit_score: 80,
      credit_rating: "A",
    },
    {
      edinet_code: "E00002",
      sec_code: "22220",
      name: "B社",
      industry: "情報・通信業",
      accounting_standard: "JP",
      credit_score: 80,
      credit_rating: "A",
    },
    {
      edinet_code: "E00003",
      sec_code: "33330",
      name: "C社",
      industry: "情報・通信業",
      accounting_standard: "JP",
      credit_score: 80,
      credit_rating: "A",
    },
  ]),
  fetchFinancials: vi.fn(async () => [
    {
      fiscal_year: 2025,
      revenue: 1000,
      operating_income: 100,
      ordinary_income: 100,
      net_income: 80,
      total_assets: 1000,
      net_assets: 700,
      eps: 100,
      per: 10,
      roe_official: 0.1,
      equity_ratio_official: 0.7,
      bps: 200,
      dividend_per_share: 10,
      cf_operating: 100,
      cf_investing: -50,
      cf_financing: -20,
      cash: 200,
      accounting_standard: "JP",
    },
  ]),
  EdinetApiError: class EdinetApiError extends Error {
    status = 500;
    responseBody = "";
  },
  EdinetRateLimitError: class EdinetRateLimitError extends Error {},
}));

vi.mock("@/lib/clients/stooq", () => ({
  toStooqSymbol: vi.fn(() => "1111.jp"),
  fetchStooqDaily: vi.fn(async () => [
    {
      date: new Date("2025-01-01T00:00:00.000Z"),
      open: 100,
      high: 101,
      low: 99,
      close: 100,
      volume: BigInt(1000),
    },
  ]),
}));

describe("collection cursor resume", () => {
  beforeEach(async () => {
    vi.resetModules();
    const { prisma } = await import("@/lib/prisma");

    await prisma.priceDaily.deleteMany();
    await prisma.financial.deleteMany();
    await prisma.collectionJob.deleteMany();
    await prisma.collectionCycle.deleteMany();
    await prisma.company.deleteMany();
    await prisma.appSetting.deleteMany();
    await prisma.samAssumption.deleteMany();
    await prisma.riskKeyword.deleteMany();
  });

  test("resumes from cursor and completes on second run", async () => {
    const { runCollectionCycle } = await import("@/lib/collection/service");

    const first = await runCollectionCycle({ maxCompanies: 2 });
    expect(first.processedThisRun).toBe(2);
    expect(first.cursor).toBe(2);

    const second = await runCollectionCycle({ maxCompanies: 2 });
    expect(second.processedThisRun).toBe(1);
    expect(second.cursor).toBe(3);
    expect(second.status).toBe("COMPLETED");
  });
});
