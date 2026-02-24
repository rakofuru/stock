import { NextResponse } from "next/server";
import { runScreening } from "@/lib/screening/service";

export async function POST() {
  try {
    const result = await runScreening();
    return NextResponse.json({ ok: true, data: result });
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

