import { NextResponse } from "next/server";
import { getCollectionStatus } from "@/lib/collection/service";

export async function GET() {
  try {
    const status = await getCollectionStatus();
    return NextResponse.json({ ok: true, data: status });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}

