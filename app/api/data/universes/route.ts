import { NextResponse } from "next/server";
import { dbErrorResponse, getUniverses, saveUniverse } from "@/lib/db";
import type { Universe } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const universes = await getUniverses();
    return NextResponse.json({ universes });
  } catch (err) {
    return dbErrorResponse(err, "세계관 목록을 불러오지 못했어요.");
  }
}

export async function POST(request: Request) {
  let universe: Universe;
  try {
    universe = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }
  if (!universe?.id || !universe.type) {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  try {
    await saveUniverse(universe);
    return NextResponse.json({ universe });
  } catch (err) {
    return dbErrorResponse(err, "세계관을 저장하지 못했어요.");
  }
}
