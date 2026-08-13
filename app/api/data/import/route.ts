import { NextResponse } from "next/server";
import { DbConfigError, importAllData } from "@/lib/db";
import type { FullExport } from "@/lib/types";

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

  try {
    await importAllData(body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "데이터를 불러오지 못했어요.",
      },
      { status: 502 }
    );
  }
}
