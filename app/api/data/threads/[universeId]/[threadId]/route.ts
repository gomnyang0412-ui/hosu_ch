import { NextResponse } from "next/server";
import { DbConfigError, deleteThread, getThread } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ universeId: string; threadId: string }> }
) {
  const { universeId, threadId } = await params;
  try {
    const thread = await getThread(universeId, threadId);
    return NextResponse.json({ thread: thread ?? null });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "대화방을 불러오지 못했어요.",
      },
      { status: 502 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ universeId: string; threadId: string }> }
) {
  const { universeId, threadId } = await params;
  try {
    await deleteThread(universeId, threadId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "대화방을 지우지 못했어요.",
      },
      { status: 502 }
    );
  }
}
