import { NextResponse } from "next/server";
import { dbErrorResponse, getRooms, saveRoom } from "@/lib/db";
import type { Room } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ universeId: string }> }
) {
  const { universeId } = await params;
  try {
    const rooms = await getRooms(universeId);
    return NextResponse.json({ rooms });
  } catch (err) {
    return dbErrorResponse(err, "대화방 목록을 불러오지 못했어요.");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ universeId: string }> }
) {
  const { universeId } = await params;
  let room: Room;
  try {
    room = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }
  if (
    !room?.id ||
    (room.kind !== "single" && room.kind !== "group") ||
    !Array.isArray(room.characterIds) ||
    !Array.isArray(room.items) ||
    (room.kind === "single" && room.characterIds.length !== 1) ||
    (room.kind === "group" && room.characterIds.length < 1)
  ) {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  try {
    await saveRoom({ ...room, universeId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return dbErrorResponse(err, "대화방을 저장하지 못했어요.");
  }
}
