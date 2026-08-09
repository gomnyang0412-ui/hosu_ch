import { NextResponse } from "next/server";
import {
  DbConfigError,
  getChatPlayerOverride,
  saveChatPlayerOverride,
} from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ universeId: string; characterId: string }> }
) {
  const { universeId, characterId } = await params;
  try {
    const playerCharacterId = await getChatPlayerOverride(universeId, characterId);
    return NextResponse.json({ playerCharacterId });
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
  let playerCharacterId: string | null;
  try {
    ({ playerCharacterId } = await request.json());
    if (playerCharacterId !== null && typeof playerCharacterId !== "string") {
      throw new Error("invalid");
    }
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }
  try {
    await saveChatPlayerOverride(universeId, characterId, playerCharacterId);
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
