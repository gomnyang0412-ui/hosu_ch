import type { Content } from "@google/genai";
import { NextResponse } from "next/server";
import {
  GeminiRequestError,
  characterLines,
  generateChatJson,
  worldBlock,
} from "@/lib/gemini";
import { parseSceneItems, serializeItems } from "@/lib/scene";
import type { ChatMessage, CharacterProfile, Universe } from "@/lib/types";

export const runtime = "nodejs";

interface ChatRequestBody {
  character: CharacterProfile;
  universe: Universe;
  history: ChatMessage[];
}

const MAX_HISTORY = 24;

function buildSystemInstruction(
  character: ChatRequestBody["character"],
  universe: Universe
): string {
  const blocks: string[] = [];

  const world_ = worldBlock(universe);
  if (world_) blocks.push(world_);

  blocks.push([`[캐릭터]`, ...characterLines(character)].join("\n"));

  blocks.push(
    [
      `[역할]`,
      `너는 AI가 아니라 위에서 설명한 캐릭터 "${character.name}" 그 자체로서 사용자와 1:1로 대화한다.`,
      `짧은 소설처럼, 상황·심리를 담은 지문과 실제 대사를 섞어서 쓴다.`,
    ].join("\n")
  );

  blocks.push(
    [
      `[규칙]`,
      `응답은 보통 1~3개 항목 정도로 짧게 끝낸다. 매 턴마다 지문을 넣을 필요는 없고, 대사만으로 충분할 때가 더 많다.`,
      `대사의 "who"는 항상 "${character.name}"으로 쓴다.`,
      `설정에 없는 부분은 캐릭터의 성격에 맞게 자연스럽게 채우되, 세계관 설정과 모순되지 않게 한다.`,
      `절대 "저는 AI 언어모델입니다" 같은 말은 하지 않는다.`,
    ].join("\n")
  );

  blocks.push(
    [
      `[출력 형식]`,
      `아래 형식의 JSON 배열만 출력한다.`,
      `지문 항목: {"t": "n", "text": "지문 내용"}`,
      `대사 항목: {"t": "d", "who": "${character.name}", "act": "행동(생략 가능)", "say": "대사"}`,
      `설명이나 코드블록 표시 없이 JSON 배열 자체만 출력한다.`,
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
    const raw = await generateChatJson({
      systemInstruction: buildSystemInstruction(body.character, body.universe),
      contents,
    });
    const items = parseSceneItems(raw);
    return NextResponse.json({ items, text: serializeItems(items) });
  } catch (err) {
    if (err instanceof GeminiRequestError) {
      const status = err.kind === "quota" ? 429 : 502;
      return NextResponse.json(
        { error: err.message, kind: err.kind },
        { status }
      );
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "알 수 없는 오류가 발생했어요.",
        kind: "parse",
      },
      { status: 502 }
    );
  }
}
