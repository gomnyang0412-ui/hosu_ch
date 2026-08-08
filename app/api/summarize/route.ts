import type { Content } from "@google/genai";
import { NextResponse } from "next/server";
import {
  GeminiRequestError,
  characterLines,
  generateSummaryText,
  worldBlock,
} from "@/lib/gemini";
import type { ChatMessage, CharacterProfile, Universe } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface SummarizeRequestBody {
  character: CharacterProfile;
  universe: Universe;
  history: ChatMessage[];
}

const MAX_HISTORY = 30;

function buildSystemInstruction(
  character: CharacterProfile,
  universe: Universe
): string {
  const blocks: string[] = [];

  const world_ = worldBlock(universe);
  if (world_) blocks.push(world_);

  blocks.push([`[캐릭터]`, ...characterLines(character)].join("\n"));

  blocks.push(
    [
      `[역할]`,
      `아래는 사용자("나")와 캐릭터 "${character.name}" 사이에 있었던 1:1 대화 기록이다.`,
      `이 기록에서 실제로 있었던 일을 새로운 장면의 도입부로 쓸 수 있도록 짧게 요약한다.`,
    ].join("\n")
  );

  blocks.push(
    [
      `[규칙]`,
      `2~4문장, 소설 지문체(3인칭, 과거형)로 요약한다.`,
      `대사를 그대로 인용하지 않고, 있었던 일과 감정선만 요약한다.`,
      `설명이나 따옴표 없이 요약 문장만 출력한다.`,
    ].join("\n")
  );

  return blocks.join("\n\n");
}

export async function POST(request: Request) {
  let body: SummarizeRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  if (!body?.character?.name || !Array.isArray(body.history)) {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  if (body.history.length === 0) {
    return NextResponse.json({ summary: "" });
  }

  const recentHistory = body.history.slice(-MAX_HISTORY);
  const userText = recentHistory
    .map((m) => `${m.role === "user" ? "나" : body.character.name}: ${m.text}`)
    .join("\n");
  const contents: Content[] = [{ role: "user", parts: [{ text: userText }] }];

  try {
    const summary = await generateSummaryText({
      systemInstruction: buildSystemInstruction(body.character, body.universe),
      contents,
    });
    return NextResponse.json({ summary: summary.trim() });
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
