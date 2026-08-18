import { NextResponse } from "next/server";
import { dbErrorResponse, getAppSettings, saveAppSettings } from "@/lib/db";
import type { AppSettings } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const settings = await getAppSettings();
    return NextResponse.json({ settings });
  } catch (err) {
    return dbErrorResponse(err, "설정을 불러오지 못했어요.");
  }
}

export async function POST(request: Request) {
  let body: Partial<AppSettings>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }
  if (
    body.backgroundImage !== undefined &&
    typeof body.backgroundImage !== "string"
  ) {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  // 기존 값을 먼저 읽어서 그 위에 얹는다 — 지금은 필드가 backgroundImage
  // 하나뿐이라 통째로 다시 만들어도 무해하지만, AppSettings에 필드가
  // 늘어나면 "이번 요청이 안 보낸 필드"가 조용히 undefined로 지워지는
  // 사고를 막기 위해 미리 이렇게 해둔다. backgroundImage는 지금처럼
  // 이 요청이 명시한 값으로 항상 덮어써서(제거 버튼이 undefined를
  // 보내는 것도 그대로 반영돼야 하므로) 기존 동작은 그대로 유지한다.
  const existing = await getAppSettings().catch(() => ({ updatedAt: 0 }) as AppSettings);
  const settings: AppSettings = {
    ...existing,
    backgroundImage: body.backgroundImage || undefined,
    updatedAt: Date.now(),
  };

  try {
    await saveAppSettings(settings);
    return NextResponse.json({ settings });
  } catch (err) {
    return dbErrorResponse(err, "설정을 저장하지 못했어요.");
  }
}
