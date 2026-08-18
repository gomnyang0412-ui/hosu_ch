import type { Content, Part } from "@google/genai";
import { NextResponse } from "next/server";
import { getCharacterMemory } from "@/lib/db";
import {
  characterLines,
  generateChatReply,
  geminiErrorResponse,
  worldBlock,
} from "@/lib/gemini";
import { buildMemoryBlock } from "@/lib/memory";
import { hasContent, parseChatReply } from "@/lib/scene";
import { serializeThreadItems } from "@/lib/thread";
import type { CharacterProfile, ThreadItem, Universe } from "@/lib/types";

/** "data:image/jpeg;base64,xxx" 형태의 dataURL을 Gemini에 보낼 수 있는 형태로 쪼갠다 */
function parseImageDataUrl(
  dataUrl: string
): { mimeType: string; data: string } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

export const runtime = "nodejs";
// 개별 시도 타임아웃(CALL_TIMEOUT_MS, 35초)이 재시도 1회까지 갈 수
// 있으니(최대 70초) 여유를 둔다. 각 시도는 자체 타임아웃으로 더 일찍
// 끊긴다.
export const maxDuration = 80;

/**
 * 1:1 채팅과 멀티 대화방의 AI 호출을 하나로 합친 라우트. 지정된 한
 * 캐릭터(target)의 대답만 만든다 — 1:1은 항상 참가자가 target 한 명뿐인
 * 방으로 취급하고, 멀티 대화방에서 여러 명에게 동시에 말을 걸고 싶으면
 * 화면 쪽에서 이 라우트를 대상 수만큼 순서대로 호출한다("선택한 사람만
 * 확실히 응답" — 그 외 인물이 우연히 끼어드는 반응 기능은 예측 불가능하다는
 * 피드백에 따라 제거했다). others(같은 방의 다른 참가자)는 target의 대답을
 * 만들 때 "이런 사람들도 함께 있다"는 맥락으로만 쓰인다.
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

  const isAU = universe.type === "au";
  blocks.push([`[캐릭터]`, ...characterLines(target, isAU)].join("\n"));

  if (others.length > 0) {
    blocks.push(
      `[함께 있는 다른 인물]\n` +
        others
          .map((c) =>
            !isAU && c.oneLiner ? `- ${c.name} (${c.oneLiner})` : `- ${c.name}`
          )
          .join("\n")
    );
  }

  if (playerCharacter) {
    blocks.push(
      `[사용자 캐릭터 — "나"]\n` +
        characterLines(playerCharacter, isAU)
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

  // 방금 사용자가 보낸 사진이 있으면(항상 items의 마지막 항목) Gemini가
  // 실제로 볼 수 있도록 이미지 파트로 함께 보낸다. 지난 턴의 사진은 이미
  // 텍스트 기록에 "[사진 첨부]"로만 남아 있고 픽셀 자체는 다시 보내지
  // 않는다 — 매 요청마다 과거 사진까지 전부 재전송하면 비용이 계속
  // 불어난다.
  const lastItem = body.items[body.items.length - 1];
  const attachedImage =
    lastItem?.t === "u" && lastItem.image
      ? parseImageDataUrl(lastItem.image)
      : null;

  try {
    const memory = body.targetId
      ? await getCharacterMemory(body.targetId, body.universe.id).catch(() => null)
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
        attachedImage
          ? `방금 사용자가 사진을 함께 보냈어. 실제로 그 사진을 보고, 사진 속 내용에 대한 "${targetName}"의 반응을 대사에 담아줘.`
          : "",
        extra ?? "",
      ]
        .filter(Boolean)
        .join("\n");
      const parts: Part[] = [{ text: userText }];
      if (attachedImage) {
        parts.push({ inlineData: attachedImage });
      }
      const contents: Content[] = [{ role: "user", parts }];
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

    const targetItems: ThreadItem[] = targetResult.items.map((it) =>
      it.t === "d"
        ? { ...it, model: targetResult!.model, keyIndex: targetResult!.keyIndex }
        : it
    );

    return NextResponse.json({ items: targetItems });
  } catch (err) {
    return geminiErrorResponse(err);
  }
}
