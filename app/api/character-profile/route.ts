import type { Content } from "@google/genai";
import { NextResponse } from "next/server";
import { GeminiRequestError, generateCharacterProfile } from "@/lib/gemini";
import type { ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface CharacterInput {
  name: string;
  oneLiner?: string;
  goal?: string;
  appearance?: string;
  scentNote?: string;
  personality?: string;
  speechStyle?: string;
  background?: string;
  lifeHistory?: string;
  relatedCharacters?: string;
  romance?: string;
  firstMessage?: string;
}

interface CharacterProfileRequestBody {
  character: CharacterInput;
  history: ChatMessage[];
}

const FIELD_LABELS: Record<keyof Omit<CharacterInput, "name">, string> = {
  oneLiner: "한 줄 소개",
  goal: "목표",
  appearance: "외형 특징",
  scentNote: "향 노트",
  personality: "성격",
  speechStyle: "말투",
  background: "배경 이야기",
  lifeHistory: "살아온 궤적",
  relatedCharacters: "연관 인물",
  romance: "애정 관계",
  firstMessage: "첫 인사",
};

// 참고할 대화가 너무 많으면 느려지니, 최근 대화 위주로 본다.
const MAX_HISTORY = 150;

function buildSystemInstruction(character: CharacterInput): string {
  const currentLines = (
    Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[]
  ).map((key) => {
    const value = character[key]?.trim();
    return `- ${FIELD_LABELS[key]}: ${value || "(비어있음)"}`;
  });

  return [
    `[캐릭터가 지금까지 입력한 설정]`,
    `- 이름: ${character.name}`,
    ...currentLines,
    ``,
    `[역할]`,
    `너는 캐릭터 설정 작가다. 아래는 사용자("나")와 이 캐릭터가 나눈 1:1 대화 기록이다.`,
    `이 대화 속에서 실제로 드러난 성격·말투·관계·사연을 바탕으로, 위 설정 항목들을 새로 쓰거나 다듬어 제안한다.`,
    ``,
    `[규칙]`,
    `이미 입력된 항목이 있다면 그 방향을 존중하되, 대화에서 드러난 모습과 자연스럽게 통합해 더 구체적이고 풍부하게 다듬는다.`,
    `대화에서 근거를 찾을 수 없는 항목(예: 대화에 로맨스가 전혀 없었다면 "애정 관계")은 억지로 지어내지 않는다 — 기존 설정이 있으면 그것만 다듬고, 기존 설정도 없고 근거도 없다면 빈 문자열로 둔다.`,
    `각 항목은 그 카테고리에 맞는 내용만 쓴다. 예를 들어 "성격"에는 성격만, "말투"에는 말투 특징만 쓴다.`,
    `"첫 인사"는 대화에서 드러난 말투를 반영해 1:1 대화를 처음 열 때 이 캐릭터가 건넬 법한 한두 문장으로 쓴다. 이미 자연스러운 인사가 있다면 억지로 바꾸지 않아도 된다.`,
    `과장하거나 대화에 없던 설정을 지어내지 말고, 실제로 드러난 모습에 근거해서 쓴다.`,
    `설명 없이 각 항목의 내용만 채운다.`,
  ].join("\n");
}

export async function POST(request: Request) {
  let body: CharacterProfileRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  if (!body?.character?.name || !Array.isArray(body.history)) {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }

  if (body.history.length === 0) {
    return NextResponse.json(
      { error: "아직 이 캐릭터와 나눈 대화가 없어요." },
      { status: 400 }
    );
  }

  const recentHistory = body.history.slice(-MAX_HISTORY);
  const userText = recentHistory
    .map((m) => `${m.role === "user" ? "나" : body.character.name}: ${m.text}`)
    .join("\n");
  const contents: Content[] = [{ role: "user", parts: [{ text: userText }] }];

  try {
    const { text: raw } = await generateCharacterProfile({
      systemInstruction: buildSystemInstruction(body.character),
      contents,
    });
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error("설정 제안 형식을 이해하지 못했어요.");
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("설정 제안 형식을 이해하지 못했어요.");
    }
    const obj = parsed as Record<string, unknown>;
    const profile: Partial<Record<keyof typeof FIELD_LABELS, string>> = {};
    for (const key of Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[]) {
      const value = obj[key];
      if (typeof value === "string" && value.trim()) {
        profile[key] = value.trim();
      }
    }
    return NextResponse.json({ profile });
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
        error: err instanceof Error ? err.message : "알 수 없는 오류가 발생했어요.",
        kind: "parse",
      },
      { status: 502 }
    );
  }
}
