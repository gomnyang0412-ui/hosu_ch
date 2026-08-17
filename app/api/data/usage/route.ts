import { NextResponse } from "next/server";
import { DbConfigError, getApiUsage } from "@/lib/db";
import { todayKST } from "@/lib/memory";

export const runtime = "nodejs";

export async function GET() {
  try {
    const date = todayKST();
    const entries = await getApiUsage(date);
    return NextResponse.json({ date, entries });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "사용량을 불러오지 못했어요.",
      },
      { status: 502 }
    );
  }
}
