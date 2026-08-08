import type { Content } from "@google/genai";
import { NextResponse } from "next/server";
import {
  GeminiRequestError,
  characterLines,
  generateChatJson,
  worldBlock,
} from "@/lib/gemini";
import { hasContent, parseSceneItems, serializeItems } from "@/lib/scene";
import type {
  ChatMessage,
  CharacterProfile,
  SceneItem,
  Universe,
} from "@/lib/types";

export const runtime = "nodejs";
// Gemini를 최대 2번(재시도 포함) 순차 호출할 수 있어, 기본 실행 시간
// 제한에 걸려 응답이 끊기지 않도록 넉넉히 늘려둔다.
export const maxDuration = 60;

interface ChatRequestBody {
  character: CharacterProfile;
  universe: Universe;
  history: ChatMessage[];
}

const MAX_HISTORY = 24;

function buildSystemInstruction(
  character: ChatRequestBody["character"],
  universe: Universe
): string {
  const blocks: string[] = [];

  const world_ = worldBlock(universe);
  if (world_) blocks.push(world_);

  blocks.push([`[캐릭터]`, ...characterLines(character)].join("\n"));

  blocks.push(
    [
      `[역할]`,
      `너는 AI가 아니라 위에서 설명한 캐릭터 "${character.name}" 그 자체로서 사용자와 1:1로 대화한다.`,
      `응답의 중심은 항상 대사다. 지문은 분위기를 살릴 때만 짧게 곁들이는 보조 요소다.`,
    ].join("\n")
  );

  blocks.push(
    [
      `[규칙]`,
      `대사(t: "d") 항목을 반드시 최소 1개 포함하고, 그 대사에는 실제로 하는 말이 구체적으로 담겨야 한다.`,
      `"...", "음..." 같은 내용 없는 말줄임표만으로 대사를 때우지 않는다. 캐릭터가 망설이거나 긴장하는 상황이라도, 그 안에서 실제로 할 만한 말을 구체적으로 쓴다.`,
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
      body.universe
    );
    const hasRealReply = (items: SceneItem[]) =>
      items.some((it) => it.t === "d" && hasContent(it.say));

    let items = parseSceneItems(
      await generateChatJson({ systemInstruction, contents })
    );
    // 가끔 대사가 빠지거나 "..."로만 때울 때가 있어, 그럴 때만 한 번 더 시도한다.
    if (!hasRealReply(items)) {
      const retryContents: Content[] = [
        ...contents,
        {
          role: "user",
          parts: [
            {
              text: `(방금 응답은 대사가 없거나 "..."뿐이었어요. 이번엔 "${body.character.name}"이(가) 실제로 무슨 말을 하는지 구체적인 대사로 다시 써줘.)`,
            },
          ],
        },
      ];
      items = parseSceneItems(
        await generateChatJson({ systemInstruction, contents: retryContents })
      );
    }
    // 대사 자체가 아예 없는 극단적인 경우에만 사용자가 다시 시도하도록 알린다.
    if (!items.some((it) => it.t === "d")) {
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
