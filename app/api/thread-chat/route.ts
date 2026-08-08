import type { Content } from "@google/genai";
import { NextResponse } from "next/server";
import {
  GeminiRequestError,
  characterLines,
  generateThreadJson,
  worldBlock,
} from "@/lib/gemini";
import { hasContent, parseSceneItems } from "@/lib/scene";
import { serializeThreadItems } from "@/lib/thread";
import type { CharacterProfile, ThreadItem, Universe } from "@/lib/types";

export const runtime = "nodejs";
// 대사 검증에 실패하면 재시도로 Gemini를 한 번 더 호출할 수 있어 여유를 둔다.
export const maxDuration = 60;

interface ThreadChatRequestBody {
  characters: CharacterProfile[];
  universe: Universe;
  targetName: string;
  items: ThreadItem[];
}

// 너무 크면 매 요청마다 처리할 토큰이 늘어나 응답이 느려진다.
const MAX_CONTEXT_ITEMS = 24;

function buildSystemInstruction(
  characters: CharacterProfile[],
  universe: Universe,
  targetName: string
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
    const systemInstruction = buildSystemInstruction(
      body.characters,
      body.universe,
      targetName
    );
    const targetReallySpoke = (list: ThreadItem[]) =>
      list.some(
        (it) => it.t === "d" && it.who === targetName && hasContent(it.say)
      );

    let items = parseSceneItems(
      await generateThreadJson({ systemInstruction, contents })
    );
    // 프롬프트로 대사를 강제해도 가끔 안 지켜질 때가 있어, 그때만 한 번 더 시도한다.
    if (!targetReallySpoke(items)) {
      const retryContents: Content[] = [
        ...contents,
        {
          role: "user",
          parts: [
            {
              text: `(방금 응답에는 ${targetName}의 실제 대사가 없었어요. 짧아도 좋으니, 이번엔 반드시 ${targetName}이 실제로 내는 말이나 소리를 대사로 써줘.)`,
            },
          ],
        },
      ];
      items = parseSceneItems(
        await generateThreadJson({ systemInstruction, contents: retryContents })
      );
    }
    if (!targetReallySpoke(items)) {
      throw new Error(`${targetName}이(가) 대답하지 않았어요. 다시 시도해 주세요.`);
    }
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
