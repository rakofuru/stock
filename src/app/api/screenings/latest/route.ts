import { NextResponse } from "next/server";
import { z } from "zod";
import { getLatestScreening } from "@/lib/screening/service";

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  perPage: z.coerce.number().int().positive().max(500).default(50),
  minScore: z.coerce.number().min(0).max(100).default(0),
  gatePassed: z
    .enum(["true", "false"]) 
    .optional()
    .transform((value) => (value == null ? undefined : value === "true")),
  industry: z.string().optional(),
  q: z.string().optional(),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.parse({
      page: url.searchParams.get("page") ?? undefined,
      perPage: url.searchParams.get("perPage") ?? undefined,
      minScore: url.searchParams.get("minScore") ?? undefined,
      gatePassed: url.searchParams.get("gatePassed") ?? undefined,
      industry: url.searchParams.get("industry") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
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

