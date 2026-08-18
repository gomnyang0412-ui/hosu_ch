import { NextResponse } from "next/server";
import {
  clearChatHistoryEverywhere,
  dbErrorResponse,
  getCharacters,
  saveCharacters,
} from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const list = await getCharacters();
    await saveCharacters(list.filter((c) => c.id !== id));
    await clearChatHistoryEverywhere(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return dbErrorResponse(err, "캐릭터를 삭제하지 못했어요.");
  }
}
