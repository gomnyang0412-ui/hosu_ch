import { NextResponse } from "next/server";
import { dbErrorResponse, importAllData } from "@/lib/db";
import { ORG_UNIVERSE_ID, type FullExport } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body: FullExport;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "파일을 읽지 못했어요. 올바른 백업 파일인지 확인해 주세요." },
      { status: 400 }
    );
  }

  // rooms(현재 형식) 또는 chats+threads(통합 이전 예전 형식) 둘 중
  //하나는 있어야 한다 — 예전에 받은 백업 파일도 계속 불러올 수 있어야
  // 진짜 롤백 경로가 된다.
  const hasCurrentShape = Array.isArray(body?.rooms);
  const hasLegacyShape =
    Array.isArray(body?.chats) && Array.isArray(body?.threads);

  if (
    !body ||
    !Array.isArray(body.characters) ||
    !Array.isArray(body.universes) ||
    !Array.isArray(body.memories) ||
    (!hasCurrentShape && !hasLegacyShape)
  ) {
    return NextResponse.json(
      { error: "백업 파일 형식이 아니에요." },
      { status: 400 }
    );
  }

  // 원작(ORG) 유니버스가 빠진 파일을 그대로 불러오면, 그 자리를 대신할
  // ORG 항목이 없어 기존 ORG 소속 방·이야기가 화면에서 찾아갈 곳을
  // 잃는다(가리키던 유니버스 목록 자체가 지워지므로). 정상적인
  // 내보내기 파일에는 항상 ORG가 포함돼 있으니, 손으로 편집했거나
  // 손상된 파일만 걸러낸다.
  if (!body.universes.some((u) => u?.id === ORG_UNIVERSE_ID)) {
    return NextResponse.json(
      { error: "백업 파일에 원작(ORG) 세계관이 없어요. 손상된 파일일 수 있어요." },
      { status: 400 }
    );
  }

  try {
    await importAllData(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return dbErrorResponse(err, "데이터를 불러오지 못했어요.");
  }
}
