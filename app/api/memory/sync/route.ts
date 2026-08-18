import { NextResponse } from "next/server";
import { DbConfigError, getCharacters, getRooms, getUniverses } from "@/lib/db";
import { syncCharacterMemory } from "@/lib/memoryService";
import type { Room } from "@/lib/types";

export const runtime = "nodejs";
// 캐릭터 × 유니버스 조합마다 밀린 날짜만큼 Gemini 요약 호출이 이어질
// 수 있어 여유를 둔다.
export const maxDuration = 60;

// 유니버스가 여러 개면 캐릭터 × 유니버스 조합 수만큼 동기화가 곱으로
// 늘어난다. 플랫폼이 함수를 강제 종료하기 전에 먼저 멈추고 "더 있다"고
// 알려서, 클라이언트의 재호출 루프(components/MemorySync.tsx, more:true면
// 곧바로 다시 부른다)로 나머지를 넘긴다.
const SYNC_ROUTE_DEADLINE_MS = 50_000;

export async function POST() {
  const startedAt = Date.now();
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

    const pairs = characters.flatMap((character) =>
      universes.map((universe) => ({ character, universe }))
    );

    let addedDays = 0;
    let more = false;
    for (const { character, universe } of pairs) {
      if (Date.now() - startedAt > SYNC_ROUTE_DEADLINE_MS) {
        more = true;
        break;
      }
      const result = await syncCharacterMemory(
        character,
        universe.id,
        characters,
        roomsByUniverse[universe.id] ?? []
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
