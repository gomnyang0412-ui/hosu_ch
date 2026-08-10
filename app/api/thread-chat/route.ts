import type { Content } from "@google/genai";
import { NextResponse } from "next/server";
import { getCharacterMemory } from "@/lib/db";
import {
  GeminiRequestError,
  characterLines,
  generateThreadJson,
  worldBlock,
} from "@/lib/gemini";
import { buildMemoryBlock } from "@/lib/memory";
import { parseSceneItems } from "@/lib/scene";
import { serializeThreadItems } from "@/lib/thread";
import type { CharacterProfile, ThreadItem, Universe } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ThreadChatRequestBody {
  characters: CharacterProfile[];
  universe: Universe;
  targetName: string;
  /** 지금 말할 차례인 캐릭터의 id (기억 조회용) */
  targetId?: string;
  items: ThreadItem[];
}

// 너무 크면 매 요청마다 처리할 토큰이 늘어나 응답이 느려진다.
const MAX_CONTEXT_ITEMS = 24;

function buildSystemInstruction(
  characters: CharacterProfile[],
  universe: Universe,
  targetName: string,
  memoryBlock?: string
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

  if (memoryBlock) blocks.push(memoryBlock);

  blocks.push(
    [
      `[역할]`,
      `너는 비주얼 노벨 각본가다. 위 인물들과 사용자("나")가 함께 있는 하나의 이야기를 짧은 소설처럼 이어 쓴다.`,
      `사용자는 이 이야기의 참가자다. 사용자의 말과 행동은 이미 대화 기록에 있으니 새로 만들지 않는다.`,
      `응답의 중심은 항상 대사다. 지문은 분위기를 살릴 때만 짧게 곁들이는 보조 요소다.`,
    ].join("\n")
  );

  blocks.push(
    [
      `[규칙]`,
      `지금 사용자가 말을 거는 대상은 "${targetName}"이다. ${targetName}은 반드시 대사(t: "d", who: "${targetName}")로 최소 한 번 응답하고, 그 대사에는 실제로 내는 소리나 말이 담겨야 한다.`,
      `"...", "음..." 같은 마침표·말줄임표뿐인 대사는 안 되지만, 짧은 감탄사나 더듬는 말(예: "어...", "그, 그게")은 괜찮다. ${targetName}이 말을 잃거나 얼어붙는 순간이라도 완전한 무음으로 두지 않고, 그 상태에 맞는 짧은 소리라도 반드시 낸다.`,
      `다른 등장인물은 그 자리에 있을 자연스러운 이유가 있고 끼어들 상황일 때만 등장시킨다. 매번 전원이 반응할 필요는 없지만, ${targetName}만은 예외 없이 실제 대사로 응답한다.`,
      `대화 기록 마지막에 "(상황 전환)"으로 표시된 지시문이 있다면, 그 지시에 맞게 시간·장소·상황이 바뀐 새 장면을 지문으로 자연스럽게 열고, ${targetName}의 대사로 이어간다.`,
      `인물마다 말투를 뚜렷이 구분해서 쓴다.`,
      `지문은 꼭 필요할 때만 짧게 넣는다. 대사만으로 끝나는 응답이 더 많아야 한다.`,
      `각 인물의 대사·행동을 정할 때는 직전 흐름의 관성보다 위 [등장 인물] 항목의 성격·말투를 매번 다시 기준으로 삼는다.`,
      `설정에 없는 부분은 각 인물의 성격에 맞게 채우되 세계관과 모순되지 않게 한다.`,
    ].join("\n")
  );

  blocks.push(
    [
      `[출력 형식]`,
      `아래 형식의 JSON 배열만 출력한다.`,
      `지문 항목: {"t": "n", "text": "지문 내용"}`,
      `대사 항목: {"t": "d", "who": "인물 이름", "act": "행동(생략 가능)", "say": "대사"}`,
      `설명이나 코드블록 표시 없이 JSON 배열 자체만 출력한다.`,
    ].join("\n")
  );

  return blocks.join("\n\n");
}

export async function POST(request: Request) {
  let body: ThreadChatRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "잘못된 요청이에요.", kind: "unknown" },
      { status: 400 }
    );
  }

  if (
    !Array.isArray(body?.characters) ||
    body.characters.length < 2 ||
    !body.targetName?.trim() ||
    !Array.isArray(body.items) ||
    body.items.length === 0
  ) {
    return NextResponse.json(
      { error: "잘못된 요청이에요.", kind: "unknown" },
      { status: 400 }
    );
  }

  const recentItems = body.items.slice(-MAX_CONTEXT_ITEMS);
  const userText = [
    `지금까지의 이야기:`,
    serializeThreadItems(recentItems),
    ``,
    `위 이야기에 자연스럽게 이어지는 다음 장면을 만들어줘. 마지막 사용자 발화(또는 지시문)에 대한 반응부터 시작해.`,
  ].join("\n");
  const contents: Content[] = [{ role: "user", parts: [{ text: userText }] }];

  try {
    const targetName = body.targetName.trim();
    const memory = body.targetId
      ? await getCharacterMemory(body.targetId).catch(() => null)
      : null;
    const systemInstruction = buildSystemInstruction(
      body.characters,
      body.universe,
      targetName,
      buildMemoryBlock(targetName, memory)
    );
    // 재시도는 실패 확률(특히 네트워크 타임아웃)을 두 배로 늘리기만 하고
    // 더 이상 에러를 막아주지도 않으니, 한 번만 호출하고 받은 그대로
    // 보여준다.
    const { text: raw, model, keyIndex } = await generateThreadJson({
      systemInstruction,
      contents,
    });
    // 화면에 "이 대사는 어떤 모델·키가 만들었는지" 작게 표시해줄 수 있도록,
    // 실제로 응답을 만든 모델/키를 대사 항목에 함께 남긴다.
    const items = parseSceneItems(raw).map((it) =>
      it.t === "d" ? { ...it, model, keyIndex } : it
    );
    return NextResponse.json({ items });
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
