import type { Content } from "@google/genai";
import { NextResponse } from "next/server";
import {
  GeminiRequestError,
  characterLines,
  generateChatJson,
  worldBlock,
} from "@/lib/gemini";
import { parseSceneItems, serializeItems } from "@/lib/scene";
import type { ChatMessage, CharacterProfile, Universe } from "@/lib/types";

export const runtime = "nodejs";

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
      `짧은 소설처럼, 상황·심리를 담은 지문과 실제 대사를 섞어서 쓴다.`,
    ].join("\n")
  );

  blocks.push(
    [
      `[규칙]`,
      `응답은 보통 1~3개 항목 정도로 짧게 끝낸다. 매 턴마다 지문을 넣을 필요는 없고, 대사만으로 충분할 때가 더 많다.`,
      `단, 대사(t: "d") 항목은 반드시 최소 1개 포함해야 한다. 지문(t: "n")만으로 응답을 끝내지 않는다 — "${character.name}"은 항상 말이나 행동으로 반응한다.`,
      `지문을 쓸 때는 반드시 그 뒤에 대사가 이어지게 한다. 지문으로 응답을 마무리하지 않는다.`,
      `캐릭터가 말을 잇지 못하거나 침묵하는 상황이라도, 그 상태 자체를 짧은 대사로 표현한다 (예: say: "..." 나 말끝을 흐리는 짧은 문장). 완전한 무응답은 없다.`,
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
    let items = parseSceneItems(
      await generateChatJson({ systemInstruction, contents })
    );
    // 가끔 지문만 있고 대사가 빠질 때가 있어, 그럴 때만 한 번 더 시도한다.
    if (!items.some((it) => it.t === "d")) {
      const retryContents: Content[] = [
        ...contents,
        {
          role: "user",
          parts: [
            {
              text: `(방금 응답에는 대사가 없었어요. 이번엔 "${body.character.name}"이(가) 짧게라도 말이나 소리로 반응하게 다시 써줘.)`,
            },
          ],
        },
      ];
      items = parseSceneItems(
        await generateChatJson({ systemInstruction, contents: retryContents })
      );
    }
    // 그래도 안 되면, 침묵도 하나의 반응이니 짧은 대사로 대신 채운다.
    if (!items.some((it) => it.t === "d")) {
      items = [...items, { t: "d", who: body.character.name, say: "..." }];
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
