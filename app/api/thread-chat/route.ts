import type { Content } from "@google/genai";
import { NextResponse } from "next/server";
import { getCharacterMemory } from "@/lib/db";
import {
  GeminiRequestError,
  characterLines,
  generateChatReply,
  generateThreadReactions,
  worldBlock,
} from "@/lib/gemini";
import { buildMemoryBlock } from "@/lib/memory";
import { parseChatReply, parseSceneItems } from "@/lib/scene";
import { serializeThreadItems } from "@/lib/thread";
import type { CharacterProfile, ThreadItem, Universe } from "@/lib/types";

export const runtime = "nodejs";
// 지정 대상의 대답(+재시도 1회) 다음에 다른 인물들의 반응까지 순서대로
// 부르니 넉넉히 잡는다. 두 번째 단계는 자체적으로 더 짧은 타임아웃을 쓴다.
export const maxDuration = 75;

interface ThreadChatRequestBody {
  /** AI가 연기하는 캐릭터들 (사용자가 자처한 캐릭터는 제외된 목록) */
  characters: CharacterProfile[];
  universe: Universe;
  targetName: string;
  /** 지금 말할 차례인 캐릭터의 id (기억 조회용) */
  targetId?: string;
  items: ThreadItem[];
  /** 사용자가 "나는 이 중 한 명이다"로 고른 캐릭터 (없으면 이름 없는 참가자) */
  playerCharacter?: CharacterProfile;
}

// 너무 크면 매 요청마다 처리할 토큰이 늘어나 응답이 느려진다.
const MAX_CONTEXT_ITEMS = 24;

/**
 * 지정 대상 한 명만 대답하게 한다 — 1:1 대화와 똑같이 "say가 스키마상
 * 필수"인 단일 객체 응답이라, 여러 인물의 순서·분량을 한 번에 맞추려던
 * 이전 방식보다 훨씬 간단하고 안정적이다.
 */
function buildTargetSystemInstruction(
  target: CharacterProfile,
  others: CharacterProfile[],
  universe: Universe,
  memoryBlock?: string,
  playerCharacter?: CharacterProfile
): string {
  const blocks: string[] = [];

  const world_ = worldBlock(universe);
  if (world_) blocks.push(world_);

  blocks.push([`[캐릭터]`, ...characterLines(target)].join("\n"));

  if (others.length > 0) {
    blocks.push(
      `[함께 있는 다른 인물]\n` +
        others
          .map((c) => `- ${c.name}${c.oneLiner ? ` (${c.oneLiner})` : ""}`)
          .join("\n")
    );
  }

  if (playerCharacter) {
    blocks.push(
      `[사용자 캐릭터 — "나"]\n` +
        characterLines(playerCharacter)
          .map((line) => `  ${line}`)
          .join("\n")
    );
  }

  if (memoryBlock) blocks.push(memoryBlock);

  blocks.push(
    [
      `[역할]`,
      `너는 AI가 아니라 위에서 설명한 캐릭터 "${target.name}" 그 자체로서, 다른 인물들도 함께 있는 자리에서 사용자("나")의 말에 반응한다.`,
      playerCharacter
        ? `사용자("나")는 바로 위 [사용자 캐릭터] 항목의 "${playerCharacter.name}" 그 자체다.`
        : `사용자("나")는 이름이 명시되지 않은 참가자다. 부를 일이 있으면 자연스러운 호칭(너, 당신 등)을 쓰고, 없는 이름을 지어내지 않는다.`,
      `지금 이 순간 실제로 응답하는 건 너("${target.name}") 한 명뿐이다. 다른 인물들의 대사까지 대신 쓰지 않는다.`,
      `응답의 중심은 항상 대사다. 지문은 분위기를 살릴 때만 짧게 곁들이는 보조 요소다.`,
    ].join("\n")
  );

  blocks.push(
    [
      `[규칙]`,
      `"say"(대사)에는 반드시 실제로 내는 소리나 말이 담겨야 한다. 빈 문자열로 두지 않는다.`,
      `"...", "음..." 같은 마침표·말줄임표뿐인 대사는 안 되지만, 짧은 감탄사나 더듬는 말(예: "어...", "그, 그게")은 괜찮다. 말을 잃거나 얼어붙는 순간이라도 완전한 무음으로 두지 않고, 그 상태에 맞는 짧은 소리라도 반드시 낸다.`,
      `"narration"(지문)은 꼭 필요할 때만 짧게 쓴다. 매 턴마다 넣을 필요는 없고, 비워도 된다.`,
      `대화 기록 마지막에 "(상황 전환)"으로 표시된 지시문이 있다면, 그 지시에 맞게 시간·장소·상황이 바뀐 새 장면을 지문으로 자연스럽게 열고 대사로 이어간다.`,
      `상황을 해석하거나 반응을 정할 때는 직전 흐름의 관성보다 위 [캐릭터] 항목의 성격·말투를 매번 다시 기준으로 삼는다.`,
      `설정에 없는 부분은 성격에 맞게 자연스럽게 채우되 세계관과 모순되지 않게 한다.`,
      `절대 "저는 AI 언어모델입니다" 같은 말은 하지 않는다.`,
    ].join("\n")
  );

  blocks.push(
    [
      `[출력 형식]`,
      `아래 형식의 JSON 객체 하나만 출력한다 (배열이 아니다).`,
      `{"narration": "지문(생략 가능)", "act": "대사와 함께 나오는 짧은 행동·표정(생략 가능)", "say": "실제 대사(필수)"}`,
      `설명이나 코드블록 표시 없이 JSON 객체 자체만 출력한다.`,
    ].join("\n")
  );

  return blocks.join("\n\n");
}

/**
 * 지정 대상 말고 다른 인물들이 방금 상황을 보고 추가로 낄지 말지를
 * 정하는 부분. 있으면 좋고 없어도 그만인 보너스라 실패해도 조용히
 * 건너뛴다 — 지정 대상의 대답 자체는 이미 끝난 뒤라 대화가 끊기지 않는다.
 */
function buildReactionSystemInstruction(
  others: CharacterProfile[],
  universe: Universe,
  targetName: string,
  targetReplyText: string
): string {
  const blocks: string[] = [];

  const world_ = worldBlock(universe);
  if (world_) blocks.push(world_);

  blocks.push(
    `[등장 인물]\n` +
      others
        .map(
          (c) =>
            `- ${c.name} -\n` +
            characterLines(c)
              .map((line) => `  ${line}`)
              .join("\n")
        )
        .join("\n")
  );

  blocks.push(`[방금 상황]\n${targetName}이(가) 방금 이렇게 반응했다: "${targetReplyText}"`);

  blocks.push(
    [
      `[역할]`,
      `너는 각본가다. 위 인물 중 지금 상황에 자연스럽게 낄 이유가 있는 사람만 짧게 반응하게 한다.`,
      `낄 이유가 없으면 아무도 반응시키지 않는다 — 전원이 매번 말할 필요는 없다.`,
      `인물마다 말투를 뚜렷이 구분해서 쓴다.`,
      `각 인물의 대사를 정할 때는 위 [등장 인물] 항목의 성격·말투를 기준으로 삼는다.`,
    ].join("\n")
  );

  blocks.push(
    [
      `[출력 형식]`,
      `아래 형식의 JSON 배열만 출력한다. 반응할 사람이 없으면 빈 배열 []을 낸다.`,
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

  const targetName = body.targetName.trim();
  const target = body.characters.find((c) => c.name === targetName);
  if (!target) {
    return NextResponse.json(
      { error: "잘못된 요청이에요.", kind: "unknown" },
      { status: 400 }
    );
  }
  const others = body.characters.filter((c) => c.name !== targetName);

  const recentItems = body.items.slice(-MAX_CONTEXT_ITEMS);
  const historyText = serializeThreadItems(recentItems);

  try {
    const memory = body.targetId
      ? await getCharacterMemory(body.targetId).catch(() => null)
      : null;
    const targetSystemInstruction = buildTargetSystemInstruction(
      target,
      others,
      body.universe,
      buildMemoryBlock(targetName, memory),
      body.playerCharacter
    );

    async function attemptTarget(
      extra?: string
    ): Promise<
      | { items: ReturnType<typeof parseChatReply>; model: string; keyIndex: number }
      | null
    > {
      const userText = [
        `지금까지의 이야기:`,
        historyText,
        ``,
        `위 이야기에서, 마지막 사용자 발화(또는 지시문)에 대한 "${targetName}"의 반응을 이어서 써줘.`,
        extra ?? "",
      ]
        .filter(Boolean)
        .join("\n");
      const contents: Content[] = [{ role: "user", parts: [{ text: userText }] }];
      const { text: raw, model, keyIndex } = await generateChatReply({
        systemInstruction: targetSystemInstruction,
        contents,
      });
      try {
        return { items: parseChatReply(raw, targetName), model, keyIndex };
      } catch {
        return null;
      }
    }

    let targetResult = await attemptTarget();
    if (!targetResult) {
      targetResult = await attemptTarget(
        `(방금 응답에는 "${targetName}"의 실제 대사가 없었어요. 짧아도 좋으니 이번엔 반드시 실제로 내는 말을 대사로 써줘.)`
      );
    }
    if (!targetResult) {
      throw new Error(`"${targetName}"이(가) 대답하지 않았어요. 다시 시도해 주세요.`);
    }

    const targetItems = targetResult.items.map((it) =>
      it.t === "d"
        ? { ...it, model: targetResult!.model, keyIndex: targetResult!.keyIndex }
        : it
    );

    // 다른 인물들의 반응은 있으면 좋고 없어도 그만인 보너스라, 실패해도
    // 조용히 건너뛴다 — 지정 대상의 대답은 이미 확보된 뒤다.
    let reactionItems: ThreadItem[] = [];
    if (others.length > 0) {
      try {
        const targetReplyText = targetItems
          .filter((it) => it.t === "d")
          .map((it) => (it as { say: string }).say)
          .join(" ");
        const { text: raw, model, keyIndex } = await generateThreadReactions({
          systemInstruction: buildReactionSystemInstruction(
            others,
            body.universe,
            targetName,
            targetReplyText
          ),
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `지금까지의 이야기:\n${historyText}\n\n위 상황과 방금 "${targetName}"의 반응을 보고, 다른 인물 중 반응할 사람이 있다면 짧게 반응해줘.`,
                },
              ],
            },
          ],
        });
        reactionItems = parseSceneItems(raw).map((it) =>
          it.t === "d" ? { ...it, model, keyIndex } : it
        );
      } catch {
        reactionItems = [];
      }
    }

    return NextResponse.json({ items: [...targetItems, ...reactionItems] });
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
