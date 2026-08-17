import type { Content } from "@google/genai";
import { NextResponse } from "next/server";
import {
  characterLines,
  generateSummaryText,
  geminiErrorResponse,
  worldBlock,
} from "@/lib/gemini";
import type { CharacterProfile, StoryEpisode, Universe } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface SummarizeArcRequestBody {
  characters: CharacterProfile[];
  universe: Universe;
  /** 압축할 화 묶음 (연속된 여러 화) */
  episodes: StoryEpisode[];
}

function buildSystemInstruction(
  characters: CharacterProfile[],
  universe: Universe
): string {
  const blocks: string[] = [];

  const world_ = worldBlock(universe);
  if (world_) blocks.push(world_);

  const isAU = universe.type === "au";
  blocks.push(
    `[등장 인물]\n` +
      characters
        .map(
          (c) =>
            `- ${c.name} -\n` +
            characterLines(c, isAU)
              .map((line) => `  ${line}`)
              .join("\n")
        )
        .join("\n")
  );

  blocks.push(
    [
      `[역할]`,
      `너는 아래 여러 화짜리 단편소설 구간을, 이야기가 계속 길어져도 나중에 다시 참고할 수 있게 압축 요약하는 편집자다.`,
      `이 구간이 지나면 본문 전체는 더 이상 참고되지 않고 이 요약만 남으니, 나중 전개에 계속 영향을 줄 만한 것 위주로 남긴다 — 사건의 전개, 인물들 사이 관계·감정 변화, 중요한 결정이나 약속, 아직 안 풀린 떡밥.`,
      `대사를 그대로 인용하지 않고, 있었던 일과 감정선 위주의 3인칭 과거형 요약 문단으로 쓴다.`,
      `3~6문장 정도로, 이 구간을 통째로 다시 읽지 않아도 이후 전개를 자연스럽게 이어갈 수 있을 만큼만 압축한다.`,
      `설명이나 따옴표 없이 요약 문단만 출력한다.`,
    ].join("\n")
  );

  return blocks.join("\n\n");
}

export async function POST(request: Request) {
  let body: SummarizeArcRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  if (
    !Array.isArray(body?.characters) ||
    body.characters.length < 2 ||
    !Array.isArray(body.episodes) ||
    body.episodes.length === 0
  ) {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const transcript = body.episodes
    .map((e) => `(${e.index}화)\n${e.text}`)
    .join("\n\n");
  const contents: Content[] = [{ role: "user", parts: [{ text: transcript }] }];

  try {
    const summary = await generateSummaryText({
      systemInstruction: buildSystemInstruction(body.characters, body.universe),
      contents,
    });
    const trimmed = summary.trim();
    if (!trimmed) {
      throw new Error("구간을 요약하지 못했어요.");
    }
    return NextResponse.json({ summary: trimmed });
  } catch (err) {
    return geminiErrorResponse(err);
  }
}
