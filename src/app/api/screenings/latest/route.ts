import { NextResponse } from "next/server";
import { z } from "zod";
import { getLatestScreening } from "@/lib/screening/service";

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(500).default(50),
  minScore: z.coerce.number().min(0).max(100).optional(),
  maxScore: z.coerce.number().min(0).max(100).optional(),
  minCoverage: z.coerce.number().min(0).max(100).optional(),
  maxCoverage: z.coerce.number().min(0).max(100).optional(),
  minPendingCount: z.coerce.number().int().min(0).optional(),
  maxPendingCount: z.coerce.number().int().min(0).optional(),
  minPbr: z.coerce.number().optional(),
  maxPbr: z.coerce.number().optional(),
  minPsr: z.coerce.number().optional(),
  maxPsr: z.coerce.number().optional(),
  minNetCash: z.coerce.number().optional(),
  maxNetCash: z.coerce.number().optional(),
  minDrawdownPct: z.coerce.number().optional(),
  maxDrawdownPct: z.coerce.number().optional(),
  gatePassed: z
    .enum(["true", "false"])
    .optional()
    .transform((value) => (value == null ? undefined : value === "true")),
  industry: z.array(z.string()).optional(),
  q: z.string().optional(),
  sortBy: z.enum(["score", "coverage", "pendingCount", "companyName", "gatePassed"]).default("score"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      perPage: url.searchParams.get("perPage") ?? undefined,
      minScore: url.searchParams.get("minScore") ?? undefined,
      maxScore: url.searchParams.get("maxScore") ?? undefined,
      minCoverage: url.searchParams.get("minCoverage") ?? undefined,
      maxCoverage: url.searchParams.get("maxCoverage") ?? undefined,
      minPendingCount: url.searchParams.get("minPendingCount") ?? undefined,
      maxPendingCount: url.searchParams.get("maxPendingCount") ?? undefined,
      minPbr: url.searchParams.get("minPbr") ?? undefined,
      maxPbr: url.searchParams.get("maxPbr") ?? undefined,
      minPsr: url.searchParams.get("minPsr") ?? undefined,
      maxPsr: url.searchParams.get("maxPsr") ?? undefined,
      minNetCash: url.searchParams.get("minNetCash") ?? undefined,
      maxNetCash: url.searchParams.get("maxNetCash") ?? undefined,
      minDrawdownPct: url.searchParams.get("minDrawdownPct") ?? undefined,
      maxDrawdownPct: url.searchParams.get("maxDrawdownPct") ?? undefined,
      gatePassed: url.searchParams.get("gatePassed") ?? undefined,
      industry: url.searchParams.getAll("industry"),
      q: url.searchParams.get("q") ?? undefined,
      sortBy: url.searchParams.get("sortBy") ?? undefined,
      sortOrder: url.searchParams.get("sortOrder") ?? undefined,
    });

    const data = await getLatestScreening(parsed);
    return NextResponse.json({ ok: true, data });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 },
    );
  }
}

