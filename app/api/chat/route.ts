import type { Content } from "@google/genai";
import { NextResponse } from "next/server";
import { getCharacterMemory } from "@/lib/db";
import {
  GeminiRequestError,
  characterLines,
  generateChatReply,
  worldBlock,
} from "@/lib/gemini";
import { buildMemoryBlock } from "@/lib/memory";
import { hasContent, parseChatReply, serializeItems } from "@/lib/scene";
import type { ChatMessage, CharacterProfile, Universe } from "@/lib/types";

export const runtime = "nodejs";
// 대사 검증에 실패하면 재시도로 Gemini를 한 번 더 호출할 수 있어 여유를 둔다.
export const maxDuration = 60;

interface ChatRequestBody {
  character: CharacterProfile;
  /** body.character가 실제로 연기하는 캐릭터의 id (기억 조회용) */
  characterId?: string;
  universe: Universe;
  history: ChatMessage[];
  /**
   * 역할 반전용: 이 값이 있으면, 사용자가 입력하는 메시지는 실제로는
   * 이 이름의 캐릭터가 하는 말이라고 AI에게 알려준다.
   */
  playerName?: string;
}

// RPD/RPM은 히스토리 크기와 무관(요청 횟수 기준)하고, TPM도 지금
// 사용량 대비 여유가 커서 늘려도 안전하다 — 다만 너무 커지면 응답
// 속도가 느려지니 무한정 올리지는 않는다.
const MAX_HISTORY = 50;

function buildSystemInstruction(
  character: ChatRequestBody["character"],
  universe: Universe,
  playerName?: string,
  memoryBlock?: string
): string {
  const blocks: string[] = [];

  const world_ = worldBlock(universe);
  if (world_) blocks.push(world_);

  blocks.push([`[캐릭터]`, ...characterLines(character)].join("\n"));

  if (memoryBlock) blocks.push(memoryBlock);

  blocks.push(
    [
      `[역할]`,
      `너는 AI가 아니라 위에서 설명한 캐릭터 "${character.name}" 그 자체로서 ${
        playerName ? `"${playerName}"과(와)` : "사용자와"
      } 1:1로 대화한다.`,
      playerName
        ? `사용자가 입력하는 메시지는 전부 "${playerName}"이(가) 하는 말과 행동이다. 너는 "${character.name}"이(가) 되어 그 상대에게 반응한다.`
        : "",
      `응답의 중심은 항상 대사다. 지문은 분위기를 살릴 때만 짧게 곁들이는 보조 요소다.`,
    ]
      .filter(Boolean)
      .join("\n")
  );

  blocks.push(
    [
      `[규칙]`,
      `"say"(대사)에는 반드시 실제로 내는 소리나 말이 담겨야 한다. 빈 문자열로 두지 않는다.`,
      `"...", "음..." 같은 마침표·말줄임표뿐인 대사는 안 되지만, 짧은 감탄사나 더듬는 말(예: "어...", "그, 그게", "아뇨, 그런 게 아니라")은 괜찮다. 캐릭터가 말을 잃거나 얼어붙는 순간이라도 완전한 무음으로 두지 않고, 그 상태에 맞는 짧은 소리라도 반드시 낸다.`,
      `"narration"(지문)은 꼭 필요할 때만 짧게 쓴다. 매 턴마다 넣을 필요는 없고, 비워도 된다. narration을 썼다면 반드시 그 상황에 바로 이어지는 say를 함께 채운다 — 지문만 쓰고 대사를 비워두지 않는다.`,
      `상황을 해석하거나 반응을 정할 때는, 직전 몇 턴의 대화 흐름에 끌려가듯 관성적으로 잇지 말고 위 [캐릭터] 항목의 성격·말투·목표를 매번 다시 기준으로 삼는다. 특히 캐릭터 설정이 방금 수정됐을 수도 있으니, 예전에 형성된 인상보다 지금 주어진 [캐릭터] 내용을 우선한다.`,
      `설정에 없는 부분은 캐릭터의 성격에 맞게 자연스럽게 채우되, 세계관 설정과 모순되지 않게 한다.`,
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

export async function POST(request: Request) {
  let body: ChatRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "잘못된 요청이에요.", kind: "unknown" },
      { status: 400 }
    );
  }

  if (!body?.character?.name || !Array.isArray(body.history)) {
    return NextResponse.json(
      { error: "잘못된 요청이에요.", kind: "unknown" },
      { status: 400 }
    );
  }

  const recentHistory = body.history.slice(-MAX_HISTORY);
  const contents: Content[] = recentHistory.map((m) => ({
    role: m.role,
    parts: [{ text: m.text }],
  }));

  try {
    const memory = body.characterId
      ? await getCharacterMemory(body.characterId).catch(() => null)
      : null;
    const systemInstruction = buildSystemInstruction(
      body.character,
      body.universe,
      body.playerName,
      buildMemoryBlock(body.character.name, memory)
    );

    // generateChatReply가 던지는 GeminiRequestError(네트워크·사용량·안전
    // 정책 등)는 여기서 삼키지 않고 그대로 위로 던진다 — 재시도해도
    // 똑같이 실패할 종류라 바로 사용자에게 알리는 게 맞다. say가 비어
    // 파싱 자체가 실패하는 경우만 null로 받아서 재시도 대상으로 삼는다.
    async function attempt(
      useContents: Content[]
    ): Promise<ReturnType<typeof parseChatReply> | null> {
      const raw = await generateChatReply({
        systemInstruction,
        contents: useContents,
      });
      try {
        return parseChatReply(raw, body.character.name);
      } catch {
        return null;
      }
    }

    const hasRealReply = (list: ReturnType<typeof parseChatReply>) =>
      list.some((it) => it.t === "d" && hasContent(it.say));

    // say는 스키마상 필수라 대사 자체가 아예 없는 응답은 거의 안 나오지만,
    // "..."처럼 내용 없는 대사로 때울 때는 있어 그럴 때만 한 번 더 시도한다.
    let items = await attempt(contents);
    if (!items || !hasRealReply(items)) {
      const retryContents: Content[] = [
        ...contents,
        {
          role: "user",
          parts: [
            {
              text: `(방금 응답에는 "${body.character.name}"의 실제 대사가 없었어요. 짧아도 좋으니, 이번엔 반드시 실제로 내는 말이나 소리를 대사로 써줘.)`,
            },
          ],
        },
      ];
      items = await attempt(retryContents);
    }
    if (!items) {
      throw new Error("캐릭터가 대답하지 않았어요. 다시 시도해 주세요.");
    }
    return NextResponse.json({ items, text: serializeItems(items) });
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
