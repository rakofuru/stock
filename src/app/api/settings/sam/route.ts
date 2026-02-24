import { NextResponse } from "next/server";
import { getSamAssumptions, recalculateSamFromMedianRevenue, updateSamAssumptions } from "@/lib/settings";

export async function GET() {
  const data = await getSamAssumptions();
  return NextResponse.json({ ok: true, data });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const payload = body?.items ?? body;
    const data = await updateSamAssumptions(payload);
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

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await recalculateSamFromMedianRevenue({
      revenueMultiplier: body?.revenueMultiplier,
      roundUnit: body?.roundUnit,
    });
    return NextResponse.json({ ok: true, data: result.data, summary: result.summary });
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

