import type { Content } from "@google/genai";
import { NextResponse } from "next/server";
import {
  GeminiRequestError,
  characterLines,
  generateStoryEpisode,
  worldBlock,
} from "@/lib/gemini";
import type { CharacterProfile, StoryEpisode, Universe } from "@/lib/types";

export const runtime = "nodejs";
// 5000자 안팎의 화 한 편을 통째로 Flash 모델로 받아야 해서 여유를 둔다.
export const maxDuration = 65;

interface SceneRequestBody {
  characters: CharacterProfile[];
  universe: Universe;
  topic: string;
  previousEpisodes?: StoryEpisode[];
  /** 시작할 때 한 번 가져온 등장인물들의 1:1 대화 요약 (있으면 매 화 계속 같이 보냄) */
  characterContext?: string;
}

/** 앞선 화들을 매번 전문으로 다시 보내면 갈수록 느려지니, 바로 직전 화만
 *  전문으로 주고 그 이전 화들은 첫 문장 정도의 줄거리 개요로 압축한다 */
const RECAP_PREVIEW_CHARS = 80;

function buildSystemInstruction(
  characters: CharacterProfile[],
  universe: Universe,
  characterContext?: string
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

  if (characterContext?.trim()) {
    blocks.push(`[등장인물의 1:1 대화 기록]\n${characterContext.trim()}`);
  }

  blocks.push(
    [
      `[역할]`,
      `너는 단편소설 작가다. 위 인물들이 등장하는 연작 단편소설을 한 화씩 이어 쓴다.`,
      `사용자는 이 이야기의 독자일 뿐, 이야기에 등장하는 인물이 아니다.`,
      characterContext?.trim()
        ? `[등장인물의 1:1 대화 기록]은 각 인물이 실제로 어떻게 말하고 행동했는지 보여주는 자료다. 인물의 성격·말투가 거기서 드러난 모습과 어긋나지 않게 쓴다.`
        : "",
    ]
      .filter(Boolean)
      .join("\n")
  );

  blocks.push(
    [
      `[문체]`,
      `일반적인 비주얼 노벨 소설의 문체를 참고하되, 대본처럼 이름표를 앞세우지 않고 3인칭 시점의 산문으로 쓴다.`,
      `인물의 대사는 큰따옴표로 표기해 서술 문단 안에 자연스럽게 녹여 쓴다. 지문·심리 묘사·배경 묘사를 문학적인 밀도로 곁들인다.`,
      `인물마다 말투를 뚜렷이 구분해서 쓴다.`,
    ].join("\n")
  );

  blocks.push(
    [
      `[규칙]`,
      `분량은 공백 포함 4500~5500자 내외로 쓴다.`,
      `인물들은 서로에게만 말하고, 독자를 의식하거나 독자에게 말을 걸지 않는다.`,
      `이번 화 안에서도 하나의 짧은 흐름을 갖되, 이야기를 완전히 매듭짓지 말고 다음 화가 자연스럽게 이어질 수 있게 여운을 남기며 끝낸다.`,
      `각 인물의 행동·대사를 정할 때는 직전 흐름의 관성보다 위 [등장 인물] 항목의 성격·말투를 매번 다시 기준으로 삼는다.`,
      `설정에 없는 부분은 각 인물의 성격에 맞게 자연스럽게 채우되 세계관과 모순되지 않게 한다.`,
    ].join("\n")
  );

  blocks.push(
    [
      `[출력 형식]`,
      `소설 본문 텍스트만 출력한다.`,
      `제목, 화수 표시("1화" 등), 설명, 마크다운 기호 없이 본문 문단만 쓴다.`,
    ].join("\n")
  );

  return blocks.join("\n\n");
}

function buildUserText(
  topic: string,
  previousEpisodes: StoryEpisode[] | undefined,
  nextIndex: number
): string {
  const blocks = [`주제: ${topic}`];
  const earlier = previousEpisodes?.slice(0, -1) ?? [];
  const last = previousEpisodes?.[previousEpisodes.length - 1];

  if (earlier.length > 0) {
    blocks.push(
      ``,
      `[지금까지의 줄거리]`,
      ...earlier.map(
        (e) =>
          `- ${e.index}화: ${e.text
            .slice(0, RECAP_PREVIEW_CHARS)
            .replace(/\s+/g, " ")
            .trim()}…`
      )
    );
  }

  if (last) {
    blocks.push(``, `[바로 직전 화 전문 (${last.index}화)]`, last.text);
    blocks.push(``, `위 이야기에 자연스럽게 이어지는 ${nextIndex}화를 써줘.`);
  } else {
    blocks.push(``, `위 주제로 1화를 시작해줘.`);
  }

  return blocks.join("\n");
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

  const nextIndex = (body.previousEpisodes?.length ?? 0) + 1;
  const userText = buildUserText(
    body.topic.trim(),
    body.previousEpisodes,
    nextIndex
  );
  const contents: Content[] = [{ role: "user", parts: [{ text: userText }] }];

  try {
    const { text } = await generateStoryEpisode({
      systemInstruction: buildSystemInstruction(
        body.characters,
        body.universe,
        body.characterContext
      ),
      contents,
    });
    const trimmed = text.trim();
    if (!trimmed) {
      throw new Error("이번 화를 만들어내지 못했어요. 다시 시도해 주세요.");
    }
    const episode: StoryEpisode = { index: nextIndex, text: trimmed };
    return NextResponse.json({ episode });
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
