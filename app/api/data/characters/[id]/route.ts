import { NextResponse } from "next/server";
import {
  DbConfigError,
  clearChatHistory,
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
    await clearChatHistory(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "캐릭터를 삭제하지 못했어요.",
      },
      { status: 502 }
    );
  }
}
