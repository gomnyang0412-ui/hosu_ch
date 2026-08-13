import { NextResponse } from "next/server";
import { DbConfigError, getCharacters, getRooms, getUniverses } from "@/lib/db";
import { syncCharacterMemory } from "@/lib/memoryService";
import type { Room } from "@/lib/types";

export const runtime = "nodejs";
// 캐릭터 여러 명 × 밀린 날짜만큼 Gemini 요약 호출이 이어질 수 있어 여유를 둔다.
export const maxDuration = 60;

export async function POST() {
  try {
    const [characters, universes] = await Promise.all([
      getCharacters(),
      getUniverses(),
    ]);
    const roomsByUniverse: Record<string, Room[]> = Object.fromEntries(
      await Promise.all(
        universes.map(async (u) => [u.id, await getRooms(u.id)] as const)
      )
    );

    let addedDays = 0;
    let more = false;
    for (const character of characters) {
      const result = await syncCharacterMemory(
        character,
        characters,
        universes,
        roomsByUniverse
      );
      addedDays += result.addedDays;
      if (result.more) more = true;
    }

    return NextResponse.json({ ok: true, addedDays, more });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof DbConfigError
            ? err.message
            : "기억을 정리하지 못했어요.",
      },
      { status: 502 }
    );
  }
}
