import { NextResponse } from "next/server";
import { DbConfigError, deleteRoom, getRoom } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ universeId: string; roomId: string }> }
) {
  const { universeId, roomId } = await params;
  try {
    const room = await getRoom(universeId, roomId);
    return NextResponse.json({ room: room ?? null });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "대화방을 불러오지 못했어요.",
      },
      { status: 502 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ universeId: string; roomId: string }> }
) {
  const { universeId, roomId } = await params;
  try {
    await deleteRoom(universeId, roomId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "대화방을 지우지 못했어요.",
      },
      { status: 502 }
    );
  }
}
