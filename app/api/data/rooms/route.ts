import { NextResponse } from "next/server";
import { dbErrorResponse, getRoomSummaries } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rooms = await getRoomSummaries();
    return NextResponse.json({ rooms });
  } catch (err) {
    return dbErrorResponse(err, "채팅 목록을 불러오지 못했어요.");
  }
}
