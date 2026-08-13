import { NextResponse } from "next/server";
import {
  DbConfigError,
  listRoomBackups,
  restoreRoomBackup,
} from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ universeId: string; roomId: string }> }
) {
  const { universeId, roomId } = await params;
  try {
    const backups = await listRoomBackups(universeId, roomId);
    return NextResponse.json({ backups });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "이전 기록을 불러오지 못했어요.",
      },
      { status: 502 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ universeId: string; roomId: string }> }
) {
  const { universeId, roomId } = await params;
  let index: number;
  try {
    ({ index } = await request.json());
    if (typeof index !== "number" || index < 0) throw new Error("invalid");
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }
  try {
    const room = await restoreRoomBackup(universeId, roomId, index);
    if (!room) {
      return NextResponse.json(
        { error: "그 시점의 기록을 찾지 못했어요." },
        { status: 404 }
      );
    }
    return NextResponse.json({ room });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "이전 기록으로 되돌리지 못했어요.",
      },
      { status: 502 }
    );
  }
}
