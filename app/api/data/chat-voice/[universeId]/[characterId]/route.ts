import { NextResponse } from "next/server";
import {
  DbConfigError,
  getChatVoiceOverride,
  saveChatVoiceOverride,
} from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ universeId: string; characterId: string }> }
) {
  const { universeId, characterId } = await params;
  try {
    const voiceCharacterId = await getChatVoiceOverride(universeId, characterId);
    return NextResponse.json({ voiceCharacterId });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "설정을 불러오지 못했어요.",
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
  let voiceCharacterId: string | null;
  try {
    ({ voiceCharacterId } = await request.json());
    if (voiceCharacterId !== null && typeof voiceCharacterId !== "string") {
      throw new Error("invalid");
    }
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }
  try {
    await saveChatVoiceOverride(universeId, characterId, voiceCharacterId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "설정을 저장하지 못했어요.",
      },
      { status: 502 }
    );
  }
}
