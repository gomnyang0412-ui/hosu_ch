import { NextResponse } from "next/server";
import { DbConfigError, getRoomSummaries } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rooms = await getRoomSummaries();
    return NextResponse.json({ rooms });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "채팅 목록을 불러오지 못했어요.",
      },
      { status: 502 }
    );
  }
}
