import { NextResponse } from "next/server";
import { dbErrorResponse, getApiUsage } from "@/lib/db";
import { todayPacific } from "@/lib/memory";

export const runtime = "nodejs";

export async function GET() {
  try {
    const date = todayPacific();
    const entries = await getApiUsage(date);
    return NextResponse.json({ date, entries });
  } catch (err) {
    return dbErrorResponse(err, "사용량을 불러오지 못했어요.");
  }
}
