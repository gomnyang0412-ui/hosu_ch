import type { Content } from "@google/genai";
import { NextResponse } from "next/server";
import { getStory } from "@/lib/db";
import {
  characterLines,
  generateSummaryText,
  geminiErrorResponse,
  worldBlock,
} from "@/lib/gemini";
import { formatElapsedDays } from "@/lib/story";
import type { CharacterProfile, ObservationSession, Universe } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** "다음 이야기로 넘어가기" 전용 요약 라우트. 화가 많이 쌓인 관찰 모드
 *  이야기 하나를 통째로 산문체 요약으로 압축해서, 같은 인물들로 새
 *  이야기를 시작할 때 배경(characterContext)으로 이어받게 한다.
 *  같은 "이야기 요약" 이름이지만 /api/summarize-story(관찰 모드에서 "이
 *  상황으로 대화 시작"용 — 짧은 지문 요약, episodes를 그대로 클라이언트가
 *  보냄)와는 목적·형식이 달라 별도 라우트로 둔다. */
interface SummarizeObservationRequestBody {
  characters: CharacterProfile[];
  universe: Universe;
  storyId: string;
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
      `너는 여러 화가 이어진 단편소설 한 편을 통째로 읽고, 그 전체를 새로 이어 쓸 후속 이야기의 배경 자료로 쓸 산문체 요약을 쓰는 편집자다.`,
      `아래 자료(지난 구간 요약, 아직 구간 요약으로 안 묶인 최근 화 전문, 현재 상태)를 모두 참고해서, 이야기 시작부터 지금까지 있었던 일의 전체 흐름 — 관계가 어떻게 시작해서 어떻게 변해왔는지, 중요한 사건과 전환점, 아직 안 풀린 약속·복선·갈등, 그리고 지금 이 순간 인물들이 어디에 있고 서로에게 어떤 감정·태도를 갖고 있는지 — 를 하나의 이어지는 글로 정리한다.`,
      `이 요약은 완전히 새로운 이야기를 시작할 때 "이 인물들 사이에 이런 일들이 있었다"는 배경으로 참고할 자료가 된다. 화 번호나 장면 단위 나열이 아니라, 처음부터 끝까지 자연스럽게 읽히는 하나의 글로 쓴다.`,
      `대사를 그대로 인용하지 않고, 있었던 일과 감정선 위주의 3인칭 과거형(단, 이야기가 지금도 이어지는 현재 상태를 설명하는 마지막 부분은 현재형) 산문으로 쓴다.`,
      `20~30문장 정도로, 세부 사건 하나하나를 다 나열하기보다 나중 이야기에 계속 영향을 줄 만한 것 위주로 쓰되, 사소해 보여도 다시 언급될 수 있는 약속·복선·소품은 생략하지 않는다.`,
      `설명이나 따옴표 없이 요약 글만 출력한다.`,
    ].join("\n")
  );

  return blocks.join("\n\n");
}

function buildTranscript(session: ObservationSession): string {
  const blocks: string[] = [`주제: ${session.topic}`];

  if (session.elapsedDays && session.elapsedDays > 0) {
    blocks.push(
      ``,
      `[이야기 속 경과 시간]`,
      `이야기가 시작된 시점으로부터 지금까지 총 ${formatElapsedDays(session.elapsedDays)}이 지났다.`
    );
  }

  if (session.arcSummaries && session.arcSummaries.length > 0) {
    blocks.push(
      ``,
      `[지난 구간 요약]`,
      ...session.arcSummaries.map((a) => `- ${a.fromIndex}~${a.toIndex}화: ${a.summary}`)
    );
  }

  const coveredThrough =
    session.arcSummaries && session.arcSummaries.length > 0
      ? Math.max(...session.arcSummaries.map((a) => a.toIndex))
      : 0;
  const tail = session.episodes.filter((e) => e.index > coveredThrough);
  if (tail.length > 0) {
    blocks.push(``, `[아직 구간 요약으로 안 묶인 최근 화 전문]`);
    for (const e of tail) {
      blocks.push(``, `(${e.index}화)`, e.text);
    }
  }

  if (session.currentState?.trim()) {
    blocks.push(``, `[현재 상태]`, session.currentState.trim());
  }

  return blocks.join("\n").replace(/^\n+/, "");
}

export async function POST(request: Request) {
  let body: SummarizeObservationRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  if (
    !Array.isArray(body?.characters) ||
    body.characters.length < 2 ||
    !body.universe?.id ||
    !body.storyId
  ) {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  const session = await getStory(body.universe.id, body.storyId);
  if (!session || session.episodes.length === 0) {
    return NextResponse.json({ error: "이야기를 찾을 수 없어요." }, { status: 404 });
  }

  const contents: Content[] = [{ role: "user", parts: [{ text: buildTranscript(session) }] }];

  try {
    const summary = await generateSummaryText({
      systemInstruction: buildSystemInstruction(body.characters, body.universe),
      contents,
    });
    const trimmed = summary.trim();
    if (!trimmed) {
      throw new Error("이야기를 요약하지 못했어요.");
    }
    return NextResponse.json({ summary: trimmed });
  } catch (err) {
    return geminiErrorResponse(err);
  }
}
