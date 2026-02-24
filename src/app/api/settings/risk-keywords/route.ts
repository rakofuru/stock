import { NextResponse } from "next/server";
import { getRiskKeywords, updateRiskKeywords } from "@/lib/settings";

export async function GET() {
  const data = await getRiskKeywords();
  return NextResponse.json({ ok: true, data });
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const payload = body?.items ?? body;
    const data = await updateRiskKeywords(payload);
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

