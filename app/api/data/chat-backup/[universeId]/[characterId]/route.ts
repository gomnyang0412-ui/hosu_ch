import { NextResponse } from "next/server";
import {
  DbConfigError,
  listChatHistoryBackups,
  restoreChatHistoryBackup,
} from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ universeId: string; characterId: string }> }
) {
  const { universeId, characterId } = await params;
  try {
    const backups = await listChatHistoryBackups(universeId, characterId);
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
  { params }: { params: Promise<{ universeId: string; characterId: string }> }
) {
  const { universeId, characterId } = await params;
  let index: number;
  try {
    ({ index } = await request.json());
    if (typeof index !== "number" || index < 0) throw new Error("invalid");
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }
  try {
    const messages = await restoreChatHistoryBackup(
      universeId,
      characterId,
      index
    );
    if (!messages) {
      return NextResponse.json(
        { error: "그 시점의 기록을 찾지 못했어요." },
        { status: 404 }
      );
    }
    return NextResponse.json({ messages });
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
