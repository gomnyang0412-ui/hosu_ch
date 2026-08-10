import type { Content } from "@google/genai";
import { NextResponse } from "next/server";
import {
  GeminiRequestError,
  characterLines,
  generateSceneJson,
  worldBlock,
} from "@/lib/gemini";
import { parseSceneItems, serializeItems } from "@/lib/scene";
import type { CharacterProfile, SceneItem, Universe } from "@/lib/types";

export const runtime = "nodejs";
// 지문+대사 10~14개짜리 긴 장면이라 시간이 좀 걸릴 수 있어 여유를 둔다.
export const maxDuration = 30;

interface SceneRequestBody {
  characters: CharacterProfile[];
  universe: Universe;
  topic: string;
  previousItems?: SceneItem[];
}

function buildSystemInstruction(
  characters: CharacterProfile[],
  universe: Universe
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
      `너는 비주얼 노벨 각본가다. 위 인물들이 등장하는 장면의 지문과 대사를 쓴다.`,
      `사용자는 이 장면의 관찰자일 뿐, 장면에 등장하는 인물이 아니다.`,
    ].join("\n")
  );

  blocks.push(
    [
      `[규칙]`,
      `인물마다 말투를 뚜렷이 구분해서 쓴다.`,
      `인물들은 서로에게만 말하고, 관찰자에게 말을 걸거나 관찰자를 의식하지 않는다.`,
      `장면을 성급하게 결론짓지 말고, 다음 내용이 자연스럽게 이어질 수 있게 열어둔 채로 끝낸다.`,
      `각 인물의 대사·행동을 정할 때는 직전 흐름의 관성보다 위 [등장 인물] 항목의 성격·말투를 매번 다시 기준으로 삼는다.`,
      `설정에 없는 부분은 각 인물의 성격에 맞게 채우되 세계관과 모순되지 않게 한다.`,
    ].join("\n")
  );

  blocks.push(
    [
      `[출력 형식]`,
      `아래 형식의 JSON 배열만 출력한다. 항목은 10개에서 14개 사이로 한다.`,
      `지문 항목: {"t": "n", "text": "지문 내용"}`,
      `대사 항목: {"t": "d", "who": "인물 이름", "act": "행동(생략 가능)", "say": "대사"}`,
      `설명이나 코드블록 표시 없이 JSON 배열 자체만 출력한다.`,
    ].join("\n")
  );

  return blocks.join("\n\n");
}

export async function POST(request: Request) {
  let body: SceneRequestBody;
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
    !body.topic?.trim()
  ) {
    return NextResponse.json(
      { error: "잘못된 요청이에요.", kind: "unknown" },
      { status: 400 }
    );
  }

  const userText = body.previousItems?.length
    ? [
        `주제: ${body.topic.trim()}`,
        ``,
        `지금까지의 장면:`,
        serializeItems(body.previousItems),
        ``,
        `위 장면에 자연스럽게 이어지는 다음 장면을 만들어줘.`,
      ].join("\n")
    : [
        `주제: ${body.topic.trim()}`,
        ``,
        `위 주제로 장면을 시작해줘.`,
      ].join("\n");

  const contents: Content[] = [{ role: "user", parts: [{ text: userText }] }];

  try {
    const raw = await generateSceneJson({
      systemInstruction: buildSystemInstruction(body.characters, body.universe),
      contents,
    });
    const items = parseSceneItems(raw);
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
        error: err instanceof Error ? err.message : "알 수 없는 오류가 발생했어요.",
        kind: "parse",
      },
      { status: 502 }
    );
  }
}
