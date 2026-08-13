import type { Content } from "@google/genai";
import { NextResponse } from "next/server";
import { getCharacterMemory } from "@/lib/db";
import {
  characterLines,
  generateChatReply,
  generateThreadReactions,
  geminiErrorResponse,
  worldBlock,
} from "@/lib/gemini";
import { buildMemoryBlock } from "@/lib/memory";
import { hasContent, parseChatReply, parseSceneItems } from "@/lib/scene";
import { serializeThreadItems } from "@/lib/thread";
import type { CharacterProfile, ThreadItem, Universe } from "@/lib/types";

export const runtime = "nodejs";
// 지정 대상의 대답(+재시도 1회) 다음에 다른 인물들의 반응(+재시도 1회)까지
// 순서대로 부를 수 있어 넉넉히 잡는다(1:1 방은 반응 단계 자체가 없어 실제로는
// 훨씬 일찍 끝난다). 각 단계는 자체 타임아웃으로 더 일찍 끊긴다.
export const maxDuration = 90;

/**
 * 1:1 채팅(`/api/chat`)과 멀티 대화방(`/api/thread-chat`)이 따로 구현하고
 * 있던 AI 호출을 하나로 합친 라우트. 1:1은 "다른 인물이 0명인 방"으로
 * 취급한다 — aiCharacters가 1개뿐이고 targetName이 그 하나뿐인 캐릭터면,
 * 반응(reaction) 단계가 자동으로 스킵돼서 예전 1:1 호출과 똑같이 딱 한 번만
 * Gemini를 부른다. 그래서 "상황 대화방"처럼 AI 참가자가 1명인 멀티 대화방도
 * 특례 코드 없이 이 라우트 하나로 자연스럽게 처리된다.
 */
interface RoomChatRequestBody {
  /** AI가 연기하는 캐릭터들 (사용자가 자처한 캐릭터는 제외). 1:1은 항상 1개 */
  aiCharacters: CharacterProfile[];
  universe: Universe;
  targetName: string;
  /** 지금 말할 차례인 캐릭터의 id (기억 조회용) */
  targetId?: string;
  items: ThreadItem[];
  /** 사용자가 자처한 캐릭터(역할 반전/"나는 이 중 한 명이다" 공통) */
  playerCharacter?: CharacterProfile;
}

// 참가자가 여럿인 방은 매 요청마다 처리할 토큰이 늘어나 응답이 느려지니
// 더 짧게 자른다. 1:1은 기존 /api/chat과 동일하게 넉넉히 준다.
const MAX_CONTEXT_ITEMS_GROUP = 24;
const MAX_CONTEXT_ITEMS_SOLO = 50;

/**
 * 지정 대상 한 명만 대답하게 한다 — "say가 스키마상 필수"인 단일 객체
 * 응답이라, 1:1이든 멀티든 항상 같은 방식으로 안정적으로 대답을 받는다.
 * others가 비어 있으면(=1:1) "다른 인물도 함께 있다"는 문구를 빼서,
 * 실제로는 혼자 있는 캐릭터가 남이 있다고 착각하지 않게 한다.
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

  const roleLines = [`[역할]`];
  if (others.length > 0) {
    roleLines.push(
      `너는 AI가 아니라 위에서 설명한 캐릭터 "${target.name}" 그 자체로서, 다른 인물들도 함께 있는 자리에서 사용자("나")의 말에 반응한다.`,
      playerCharacter
        ? `사용자("나")는 바로 위 [사용자 캐릭터] 항목의 "${playerCharacter.name}" 그 자체다.`
        : `사용자("나")는 이름이 명시되지 않은 참가자다. 부를 일이 있으면 자연스러운 호칭(너, 당신 등)을 쓰고, 없는 이름을 지어내지 않는다.`,
      `지금 이 순간 실제로 응답하는 건 너("${target.name}") 한 명뿐이다. 다른 인물들의 대사까지 대신 쓰지 않는다.`
    );
  } else {
    roleLines.push(
      `너는 AI가 아니라 위에서 설명한 캐릭터 "${target.name}" 그 자체로서 ${
        playerCharacter ? `"${playerCharacter.name}"과(와)` : "사용자와"
      } 1:1로 대화한다.`
    );
    if (playerCharacter) {
      roleLines.push(
        `사용자가 입력하는 메시지는 전부 "${playerCharacter.name}"이(가) 하는 말과 행동이다. 너는 "${target.name}"이(가) 되어 그 상대에게 반응한다.`
      );
    }
  }
  roleLines.push(
    `응답의 중심은 항상 대사다. 지문은 분위기를 살릴 때만 짧게 곁들이는 보조 요소다.`
  );
  blocks.push(roleLines.join("\n"));

  const ruleLines = [
    `[규칙]`,
    `"say"(대사)에는 반드시 실제로 내는 소리나 말이 담겨야 한다. 빈 문자열로 두지 않는다.`,
    `"...", "음..." 같은 마침표·말줄임표뿐인 대사는 안 되지만, 짧은 감탄사나 더듬는 말(예: "어...", "그, 그게", "아뇨, 그런 게 아니라")은 괜찮다. 캐릭터가 말을 잃거나 얼어붙는 순간이라도 완전한 무음으로 두지 않고, 그 상태에 맞는 짧은 소리라도 반드시 낸다.`,
    `"narration"(지문)은 꼭 필요할 때만 짧게 쓴다. 매 턴마다 넣을 필요는 없고, 비워도 된다.`,
  ];
  if (others.length > 0) {
    ruleLines.push(
      `대화 기록 마지막에 "(상황 전환)"으로 표시된 지시문이 있다면, 그 지시에 맞게 시간·장소·상황이 바뀐 새 장면을 지문으로 자연스럽게 열고 대사로 이어간다.`
    );
  }
  ruleLines.push(
    `상황을 해석하거나 반응을 정할 때는, 직전 흐름에 끌려가듯 관성적으로 잇지 말고 위 [캐릭터] 항목의 성격·말투를 매번 다시 기준으로 삼는다. 특히 캐릭터 설정이 방금 수정됐을 수도 있으니, 예전에 형성된 인상보다 지금 주어진 [캐릭터] 내용을 우선한다.`,
    `설정에 없는 부분은 성격에 맞게 자연스럽게 채우되 세계관과 모순되지 않게 한다.`,
    `절대 "저는 AI 언어모델입니다" 같은 말은 하지 않는다.`
  );
  blocks.push(ruleLines.join("\n"));

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
 * 지정 대상 말고 다른 인물 중 최소 한 명이 방금 상황을 보고 반응하게
 * 만드는 부분. aiCharacters가 1명뿐인 방(=1:1, 또는 상황 대화방처럼 AI
 * 참가자가 1명인 멀티 대화방)에서는 others가 비어서 이 단계 자체가
 * 호출되지 않는다.
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
      `너는 각본가다. 위 인물 중 최소 한 명은 지금 상황을 보고 반드시 짧게라도 반응한다 — 완전히 무시하고 지나가는 인물만 있는 건 안 된다.`,
      `그 자리에 있을 자연스러운 이유가 있는 인물부터 우선 반응시키되, 정 반응할 이유가 마땅치 않다면 가장 그 상황에 관심을 가질 법한 인물이라도 짧은 한마디로 반응한다.`,
      `전원이 다 말할 필요는 없다 — 최소 한 명이면 충분하다.`,
      `인물마다 말투를 뚜렷이 구분해서 쓴다.`,
      `각 인물의 대사를 정할 때는 위 [등장 인물] 항목의 성격·말투를 기준으로 삼는다.`,
    ].join("\n")
  );

  blocks.push(
    [
      `[출력 형식]`,
      `아래 형식의 JSON 배열만 출력한다. 최소 1개, 최대 3개의 항목을 담는다.`,
      `대사 항목: {"t": "d", "who": "인물 이름", "act": "행동(생략 가능)", "say": "대사"}`,
      `설명이나 코드블록 표시 없이 JSON 배열 자체만 출력한다.`,
    ].join("\n")
  );

  return blocks.join("\n\n");
}

export async function POST(request: Request) {
  let body: RoomChatRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "잘못된 요청이에요.", kind: "unknown" },
      { status: 400 }
    );
  }

  if (
    !Array.isArray(body?.aiCharacters) ||
    body.aiCharacters.length < 1 ||
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
  const target = body.aiCharacters.find((c) => c.name === targetName);
  if (!target) {
    return NextResponse.json(
      { error: "잘못된 요청이에요.", kind: "unknown" },
      { status: 400 }
    );
  }
  const others = body.aiCharacters.filter((c) => c.name !== targetName);

  const contextSize =
    others.length > 0 ? MAX_CONTEXT_ITEMS_GROUP : MAX_CONTEXT_ITEMS_SOLO;
  const recentItems = body.items.slice(-contextSize);
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

    const hasRealReply = (list: ReturnType<typeof parseChatReply>) =>
      list.some((it) => it.t === "d" && hasContent(it.say));

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
    if (!targetResult || !hasRealReply(targetResult.items)) {
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

    // 지정 대상의 대답은 이미 확보된 뒤라, 다른 인물들의 반응 단계가
    // 전부 실패해도(또는 애초에 다른 인물이 없어도) 대화 자체는 끊기지
    // 않는다.
    let reactionItems: ThreadItem[] = [];
    if (others.length > 0) {
      const targetReplyText = targetItems
        .filter((it) => it.t === "d")
        .map((it) => (it as { say: string }).say)
        .join(" ");
      const reactionSystemInstruction = buildReactionSystemInstruction(
        others,
        body.universe,
        targetName,
        targetReplyText
      );

      async function attemptReactions(extra?: string): Promise<ThreadItem[]> {
        const { text: raw, model, keyIndex } = await generateThreadReactions({
          systemInstruction: reactionSystemInstruction,
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: [
                    `지금까지의 이야기:`,
                    historyText,
                    ``,
                    `위 상황과 방금 "${targetName}"의 반응을 보고, 다른 인물 중 최소 한 명이 반응해줘.`,
                    extra ?? "",
                  ]
                    .filter(Boolean)
                    .join("\n"),
                },
              ],
            },
          ],
        });
        return parseSceneItems(raw).map((it) =>
          it.t === "d" ? { ...it, model, keyIndex } : it
        );
      }

      try {
        reactionItems = await attemptReactions();
      } catch {
        try {
          reactionItems = await attemptReactions(
            `(방금 응답에는 아무도 반응하지 않았어요. 누구든 좋으니 최소 한 명은 짧게라도 반드시 반응하는 대사를 넣어줘.)`
          );
        } catch {
          reactionItems = [];
        }
      }
    }

    return NextResponse.json({ items: [...targetItems, ...reactionItems] });
  } catch (err) {
    return geminiErrorResponse(err);
  }
}
