import { NextResponse } from "next/server";
import { dbErrorResponse, deleteStory, getStory } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ universeId: string; storyId: string }> }
) {
  const { universeId, storyId } = await params;
  try {
    const story = await getStory(universeId, storyId);
    return NextResponse.json({ story: story ?? null });
  } catch (err) {
    return dbErrorResponse(err, "이야기를 불러오지 못했어요.");
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ universeId: string; storyId: string }> }
) {
  const { universeId, storyId } = await params;
  try {
    await deleteStory(universeId, storyId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return dbErrorResponse(err, "이야기를 지우지 못했어요.");
  }
}
