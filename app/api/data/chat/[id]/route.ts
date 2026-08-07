import { NextResponse } from "next/server";
import {
  DbConfigError,
  clearChatHistory,
  getChatHistory,
  saveChatHistory,
} from "@/lib/db";
import type { ChatMessage } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const messages = await getChatHistory(id);
    return NextResponse.json({ messages });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "대화 기록을 불러오지 못했어요.",
      },
      { status: 502 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let messages: ChatMessage[];
  try {
    ({ messages } = await request.json());
    if (!Array.isArray(messages)) throw new Error("invalid");
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }
  try {
    await saveChatHistory(id, messages);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "대화 기록을 저장하지 못했어요.",
      },
      { status: 502 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    await clearChatHistory(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "대화 기록을 지우지 못했어요.",
      },
      { status: 502 }
    );
  }
}
