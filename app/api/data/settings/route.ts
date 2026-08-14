import { NextResponse } from "next/server";
import { DbConfigError, getAppSettings, saveAppSettings } from "@/lib/db";
import type { AppSettings } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const settings = await getAppSettings();
    return NextResponse.json({ settings });
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

  const settings: AppSettings = {
    backgroundImage: body.backgroundImage || undefined,
    updatedAt: Date.now(),
  };

  try {
    await saveAppSettings(settings);
    return NextResponse.json({ settings });
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
