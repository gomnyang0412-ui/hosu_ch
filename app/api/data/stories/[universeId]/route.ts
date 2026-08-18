import { NextResponse } from "next/server";
import { dbErrorResponse, getStories, saveStory } from "@/lib/db";
import type { ObservationSession } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ universeId: string }> }
) {
  const { universeId } = await params;
  try {
    const stories = await getStories(universeId);
    return NextResponse.json({ stories });
  } catch (err) {
    return dbErrorResponse(err, "이야기 목록을 불러오지 못했어요.");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ universeId: string }> }
) {
  const { universeId } = await params;
  let story: ObservationSession;
  try {
    story = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }
  if (
    !story?.id ||
    !Array.isArray(story.characterIds) ||
    story.characterIds.length < 1
  ) {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  try {
    await saveStory({ ...story, universeId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return dbErrorResponse(err, "이야기를 저장하지 못했어요.");
  }
}
