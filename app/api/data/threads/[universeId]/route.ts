import { NextResponse } from "next/server";
import { DbConfigError, getThreads, saveThread } from "@/lib/db";
import type { MultiThread } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ universeId: string }> }
) {
  const { universeId } = await params;
  try {
    const threads = await getThreads(universeId);
    return NextResponse.json({ threads });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "대화방 목록을 불러오지 못했어요.",
      },
      { status: 502 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ universeId: string }> }
) {
  const { universeId } = await params;
  let thread: MultiThread;
  try {
    thread = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }
  if (!thread?.id || !Array.isArray(thread.characterIds)) {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  try {
    await saveThread({ ...thread, universeId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "대화방을 저장하지 못했어요.",
      },
      { status: 502 }
    );
  }
}
