import { NextResponse } from "next/server";
import { z } from "zod";
import { runCollectionCycle } from "@/lib/collection/service";

const requestSchema = z.object({
  maxCompanies: z.number().int().positive().max(980).optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const parsed = requestSchema.parse(body);
    const result = await runCollectionCycle(parsed);
    return NextResponse.json({ ok: true, data: result });
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

