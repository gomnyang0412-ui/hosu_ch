import { NextResponse } from "next/server";
import { DbConfigError, getWorld, saveWorld } from "@/lib/db";
import type { World } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getWorld());
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "세계관 설정을 불러오지 못했어요.",
      },
      { status: 502 }
    );
  }
}

export async function POST(request: Request) {
  let world: World;
  try {
    world = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }
  try {
    await saveWorld(world);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "세계관 설정을 저장하지 못했어요.",
      },
      { status: 502 }
    );
  }
}
