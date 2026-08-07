import type { Content } from "@google/genai";
import { NextResponse } from "next/server";
import {
  GeminiRequestError,
  characterLines,
  generateChatReply,
  worldBlock,
} from "@/lib/gemini";
import type { ChatMessage, CharacterProfile, World } from "@/lib/types";

export const runtime = "nodejs";

interface ChatRequestBody {
  character: CharacterProfile;
  world: World;
  history: ChatMessage[];
}

const MAX_HISTORY = 24;

function buildSystemInstruction(
  character: ChatRequestBody["character"],
  world: World
): string {
  const blocks: string[] = [];

  const world_ = worldBlock(world);
  if (world_) blocks.push(world_);

  blocks.push([`[캐릭터]`, ...characterLines(character)].join("\n"));

  blocks.push(
    [
      `[규칙]`,
      `너는 AI가 아니라 위에서 설명한 캐릭터 "${character.name}" 그 자체로서 사용자와 1:1로 대화한다.`,
      `응답은 보통 1~4문장 정도로, 실제 메신저 대화처럼 자연스럽게 한다.`,
      `행동이나 표정을 표현할 때는 *별표* 안에 짧게 넣는다. 예: *살짝 웃으며* 오랜만이야.`,
      `설정에 없는 부분은 캐릭터의 성격에 맞게 자연스럽게 채우되, 세계관 설정과 모순되지 않게 한다.`,
      `절대 "저는 AI 언어모델입니다" 같은 말은 하지 않는다.`,
    ].join("\n")
  );

  return blocks.join("\n\n");
}

export async function POST(request: Request) {
  let body: ChatRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "잘못된 요청이에요.", kind: "unknown" },
      { status: 400 }
    );
  }

  if (!body?.character?.name || !Array.isArray(body.history)) {
    return NextResponse.json(
      { error: "잘못된 요청이에요.", kind: "unknown" },
      { status: 400 }
    );
  }

  const recentHistory = body.history.slice(-MAX_HISTORY);
  const contents: Content[] = recentHistory.map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }));

  try {
    const reply = await generateChatReply({
      systemInstruction: buildSystemInstruction(body.character, body.world),
      contents,
    });
    return NextResponse.json({ reply });
  } catch (err) {
    if (err instanceof GeminiRequestError) {
      const status = err.kind === "quota" ? 429 : 502;
      return NextResponse.json(
        { error: err.message, kind: err.kind },
        { status }
      );
    }
    return NextResponse.json(
      { error: "알 수 없는 오류가 발생했어요.", kind: "unknown" },
      { status: 500 }
    );
  }
}
