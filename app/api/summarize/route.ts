import type { Content } from "@google/genai";
import { NextResponse } from "next/server";
import { getCharacterMemory } from "@/lib/db";
import {
  GeminiRequestError,
  characterLines,
  generateSummaryText,
  worldBlock,
} from "@/lib/gemini";
import { memoryOneLiners } from "@/lib/memory";
import type { ChatMessage, CharacterProfile, Universe } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface SummarizeRequestBody {
  character: CharacterProfile;
  /** 캐릭터의 누적 기억(장기 기억)을 같이 붙이고 싶을 때 넘기는 id */
  characterId?: string;
  universe: Universe;
  history: ChatMessage[];
}

// 멀티 대화방 생성 시 한 번만 호출되는 요약이라(매 턴 반복되는 비용이
// 아님), 조금 더 넉넉하게 원본을 보고 자세한 요약을 뽑아도 부담이 적다.
const MAX_HISTORY = 100;

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
      `6~10문장, 소설 지문체(3인칭, 과거형)로 요약한다.`,
      `있었던 일을 시간 순서대로, 구체적인 사건·계기·전환점을 짚어가며 자세히 쓴다. 두루뭉술하게 뭉치지 말고, 어떤 대화 끝에 무슨 일이 있었는지가 드러나게 한다.`,
      `인물들 사이에 생긴 감정 변화나 관계의 뉘앙스(가까워짐, 서먹해짐, 오해, 긴장 등)가 있었다면 놓치지 않고 담는다.`,
      `대사를 그대로 인용하지는 않되, 어떤 맥락에서 어떤 취지의 말이 오갔는지는 구체적으로 풀어 쓴다.`,
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
    // 방금 만든 상세 요약은 최근 대화(최대 100개)까지만 다루니, 그보다
    // 오래된 기억(하루/주/달 단위로 이미 압축된 것)은 한 줄씩이라도
    // 덧붙여서 아예 누락되지 않게 한다.
    const memory = body.characterId
      ? await getCharacterMemory(body.characterId).catch(() => null)
      : null;
    const olderLines = memoryOneLiners(memory);
    const combined =
      olderLines.length > 0
        ? [summary.trim(), `[그 이전 기억]`, ...olderLines].join("\n")
        : summary.trim();
    return NextResponse.json({ summary: combined });
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
