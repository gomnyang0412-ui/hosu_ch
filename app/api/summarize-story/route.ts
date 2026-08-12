import type { Content } from "@google/genai";
import { NextResponse } from "next/server";
import {
  GeminiRequestError,
  characterLines,
  generateSummaryText,
  worldBlock,
} from "@/lib/gemini";
import type { CharacterProfile, StoryEpisode, Universe } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface SummarizeStoryRequestBody {
  characters: CharacterProfile[];
  universe: Universe;
  episodes: StoryEpisode[];
}

function buildSystemInstruction(
  characters: CharacterProfile[],
  universe: Universe
): string {
  const blocks: string[] = [];

  const world_ = worldBlock(universe);
  if (world_) blocks.push(world_);

  blocks.push(
    `[등장 인물]\n` +
      characters
        .map(
          (c) =>
            `- ${c.name} -\n` +
            characterLines(c)
              .map((line) => `  ${line}`)
              .join("\n")
        )
        .join("\n")
  );

  blocks.push(
    [
      `[역할]`,
      `아래는 지금까지 이어 쓴 단편소설의 전체 내용이다.`,
      `이 내용을, 등장인물들이 그 상황을 정확히 겪고 기억하고 있다는 전제로 새 대화를 시작할 수 있는 지문 요약으로 만든다.`,
    ].join("\n")
  );

  blocks.push(
    [
      `[규칙]`,
      `10줄 안팎으로, 있었던 일을 시간 순서대로 구체적으로 정리한다. 두루뭉술하게 뭉치지 말고, 어떤 사건·계기·전환점이 있었는지가 드러나게 쓴다.`,
      `인물들 사이에 생긴 감정 변화나 관계의 뉘앙스(가까워짐, 갈등, 오해, 긴장 등)가 있었다면 놓치지 않고 담는다.`,
      `소설 지문체(3인칭, 과거형)로 쓴다.`,
      `설명이나 따옴표 없이 요약 내용만 출력한다.`,
    ].join("\n")
  );

  return blocks.join("\n\n");
}

export async function POST(request: Request) {
  let body: SummarizeStoryRequestBody;
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

  const userText = body.episodes
    .map((e) => `[${e.index}화]\n${e.text}`)
    .join("\n\n");
  const contents: Content[] = [{ role: "user", parts: [{ text: userText }] }];

  try {
    const summary = await generateSummaryText({
      systemInstruction: buildSystemInstruction(body.characters, body.universe),
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
