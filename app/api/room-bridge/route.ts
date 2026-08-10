import type { Content } from "@google/genai";
import { NextResponse } from "next/server";
import {
  GeminiRequestError,
  characterLines,
  generateSummaryText,
  worldBlock,
} from "@/lib/gemini";
import type { CharacterProfile, Universe } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

interface BridgeRequestBody {
  character: CharacterProfile;
  universe: Universe;
  /** 다른 방에서 오늘 나눈 대화들 */
  transcripts: { withWhom: string; text: string }[];
}

function buildSystemInstruction(
  character: CharacterProfile,
  universe: Universe,
  withWhomList: string[]
): string {
  const blocks: string[] = [];

  const world_ = worldBlock(universe);
  if (world_) blocks.push(world_);

  blocks.push([`[캐릭터]`, ...characterLines(character)].join("\n"));

  blocks.push(
    [
      `[역할]`,
      `아래는 오늘 "${character.name}"이(가) 다른 자리(${withWhomList.join(", ")})에서 나눈 대화 기록이다.`,
      `지금 이 인물이 새로운 대화 상대를 만나기 직전, 오늘 있었던 일을 스스로 떠올리듯 정리한다.`,
    ].join("\n")
  );

  blocks.push(
    [
      `[규칙]`,
      `2~4문장, 소설 지문체(3인칭, 과거형)로 요약한다.`,
      `여러 상대와 있었던 일이면 자연스럽게 하나의 흐름으로 엮는다.`,
      `대사를 그대로 인용하지 않고, 있었던 일과 감정선만 요약한다.`,
      `설명이나 따옴표 없이 요약 문장만 출력한다.`,
    ].join("\n")
  );

  return blocks.join("\n\n");
}

export async function POST(request: Request) {
  let body: BridgeRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  if (
    !body?.character?.name ||
    !Array.isArray(body.transcripts) ||
    body.transcripts.length === 0
  ) {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const withWhomList = body.transcripts.map((t) => t.withWhom);
  const userText = body.transcripts
    .map((t) => `[${t.withWhom}와(과)의 대화]\n${t.text}`)
    .join("\n\n");
  const contents: Content[] = [{ role: "user", parts: [{ text: userText }] }];

  try {
    const summary = await generateSummaryText({
      systemInstruction: buildSystemInstruction(
        body.character,
        body.universe,
        withWhomList
      ),
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
