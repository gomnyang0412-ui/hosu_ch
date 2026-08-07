import { NextResponse } from "next/server";
import { DbConfigError, getCharacters, saveCharacters } from "@/lib/db";
import type { Character } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const characters = await getCharacters();
    return NextResponse.json({ characters });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "캐릭터 목록을 불러오지 못했어요.",
      },
      { status: 502 }
    );
  }
}

export async function POST(request: Request) {
  let character: Character;
  try {
    character = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }
  if (!character?.id || !character.name) {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  try {
    const list = await getCharacters();
    const idx = list.findIndex((c) => c.id === character.id);
    if (idx >= 0) {
      list[idx] = character;
    } else {
      list.push(character);
    }
    await saveCharacters(list);
    return NextResponse.json({ character });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "캐릭터를 저장하지 못했어요.",
      },
      { status: 502 }
    );
  }
}
