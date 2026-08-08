import type { Content } from "@google/genai";
import { NextResponse } from "next/server";
import {
  GeminiRequestError,
  characterLines,
  generateChatJson,
  worldBlock,
} from "@/lib/gemini";
import { hasContent, parseSceneItems, serializeItems } from "@/lib/scene";
import type { ChatMessage, CharacterProfile, Universe } from "@/lib/types";

export const runtime = "nodejs";
// 대사 검증에 실패하면 재시도로 Gemini를 한 번 더 호출할 수 있어 여유를 둔다.
export const maxDuration = 60;

interface ChatRequestBody {
  character: CharacterProfile;
  universe: Universe;
  history: ChatMessage[];
  /**
   * 역할 반전용: 이 값이 있으면, 사용자가 입력하는 메시지는 실제로는
   * 이 이름의 캐릭터가 하는 말이라고 AI에게 알려준다.
   */
  playerName?: string;
}

// 너무 크면 매 요청마다 처리할 토큰이 늘어나 응답이 느려진다.
const MAX_HISTORY = 16;

function buildSystemInstruction(
  character: ChatRequestBody["character"],
  universe: Universe,
  playerName?: string
): string {
  const blocks: string[] = [];

  const world_ = worldBlock(universe);
  if (world_) blocks.push(world_);

  blocks.push([`[캐릭터]`, ...characterLines(character)].join("\n"));

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
      `대사(t: "d") 항목을 반드시 최소 1개 포함하고, 그 대사에는 실제로 내는 소리나 말이 담겨야 한다.`,
      `"...", "음..." 같은 마침표·말줄임표뿐인 대사는 안 되지만, 짧은 감탄사나 더듬는 말(예: "어...", "그, 그게", "아뇨, 그런 게 아니라")은 괜찮다. 캐릭터가 말을 잃거나 얼어붙는 순간이라도 완전한 무음으로 두지 않고, 그 상태에 맞는 짧은 소리라도 반드시 낸다.`,
      `지문(t: "n")은 꼭 필요할 때만 짧게 넣는다. 매 턴마다 넣을 필요는 없고, 대사만으로 끝나는 응답이 더 많아야 한다. 지문만으로 응답을 마무리하지 않는다 — 지문 뒤에는 항상 대사가 이어진다.`,
      `대사의 "who"는 항상 "${character.name}"으로 쓴다.`,
      `설정에 없는 부분은 캐릭터의 성격에 맞게 자연스럽게 채우되, 세계관 설정과 모순되지 않게 한다.`,
      `절대 "저는 AI 언어모델입니다" 같은 말은 하지 않는다.`,
    ].join("\n")
  );

  blocks.push(
    [
      `[출력 형식]`,
      `아래 형식의 JSON 배열만 출력한다.`,
      `지문 항목: {"t": "n", "text": "지문 내용"}`,
      `대사 항목: {"t": "d", "who": "${character.name}", "act": "행동(생략 가능)", "say": "대사"}`,
      `설명이나 코드블록 표시 없이 JSON 배열 자체만 출력한다.`,
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
    const systemInstruction = buildSystemInstruction(
      body.character,
      body.universe,
      body.playerName
    );
    const hasRealReply = (list: ReturnType<typeof parseSceneItems>) =>
      list.some((it) => it.t === "d" && hasContent(it.say));

    let items = parseSceneItems(
      await generateChatJson({ systemInstruction, contents })
    );
    // 캐릭터 설정(특히 순종적·긴장 상태 같은 성격)에 끌려가서 대사 없이
    // 지문만 쓸 때가 있어, 그럴 때만 한 번 더 시도한다. 그래도 안
    // 나오면 에러로 막지 않고 받은 그대로 보여준다 — 막히는 것보다는
    // 낫다.
    if (!hasRealReply(items)) {
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
      items = parseSceneItems(
        await generateChatJson({ systemInstruction, contents: retryContents })
      );
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
