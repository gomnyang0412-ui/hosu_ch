import type { Content } from "@google/genai";
import { NextResponse } from "next/server";
import {
  characterLines,
  generateStoryEpisode,
  geminiErrorResponse,
  worldBlock,
} from "@/lib/gemini";
import type { CharacterProfile, StoryEpisode, Universe } from "@/lib/types";

export const runtime = "nodejs";
// 화 하나를 5000자 통째로 한 번에 쓰게 하면 그 호출 하나가 오래 걸려서
// 호스팅 플랫폼의 함수 실행 제한에 걸리기 쉬웠다. 그래서 화 하나를 절반씩
// 두 번의 짧은 호출로 나눠 쓰는데(아래 POST 참고), 그 두 호출 다 합쳐도
// 넉넉하도록 여유를 둔다.
export const maxDuration = 90;

interface SceneRequestBody {
  characters: CharacterProfile[];
  universe: Universe;
  topic: string;
  previousEpisodes?: StoryEpisode[];
  /** 시작할 때 한 번 가져온 등장인물들의 1:1 대화 요약 (있으면 매 화 계속 같이 보냄) */
  characterContext?: string;
  /** 사용자가 이번 화에 반드시 들어가길 바라는 사건 한 줄 (없으면 자유 전개) */
  directive?: string;
}

/** 앞선 화들을 매번 전문으로 다시 보내면 갈수록 느려지니, 바로 직전 화만
 *  전문으로 주고 그 이전 화들은 첫 문장 정도의 줄거리 개요로 압축한다 */
const RECAP_PREVIEW_CHARS = 80;

/** 화 하나(4500~5500자)를 한 호출로 쓰게 하면 호출 하나가 너무 오래
 *  걸려서, 절반씩 두 번의 짧은 호출로 나눠 쓰고 이어 붙인다. */
type Part = "first" | "second";

function buildSystemInstruction(
  characters: CharacterProfile[],
  universe: Universe,
  characterContext: string | undefined,
  part: Part
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

  const lengthRule =
    part === "first"
      ? `지금 쓰는 건 이번 화의 앞부분이다. 분량은 공백 포함 2200~2800자 내외로 쓴다. 화를 매듭짓지 말고, 이야기가 계속 이어질 수 있는 자연스러운 지점에서 멈춘다.`
      : `지금 쓰는 건 이번 화의 나머지 뒷부분이다. [지금까지 쓴 이번 화 앞부분]에 바로 이어서, 그 내용을 반복하거나 요약하지 말고 쓴다. 분량은 공백 포함 2200~2800자 내외로 쓴다. 이번 화를 여기서 마무리하되, 완전히 매듭짓지 말고 다음 화가 자연스럽게 이어질 수 있게 여운을 남기며 끝낸다.`;

  blocks.push(
    [
      `[규칙]`,
      lengthRule,
      `인물들은 서로에게만 말하고, 독자를 의식하거나 독자에게 말을 걸지 않는다.`,
      `사용자가 [다음 화 지시]를 줬다면 그 사건이 이번 화 안에서 분명히 일어나게 하되, 그 사건에 이르는 과정·전후 전개·세부 묘사는 자유롭게 창작한다.`,
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
  nextIndex: number,
  directive?: string,
  writtenSoFar?: string
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
  }

  if (directive?.trim()) {
    blocks.push(``, `[다음 화 지시]`, directive.trim());
  }

  if (writtenSoFar) {
    blocks.push(``, `[지금까지 쓴 이번 화 앞부분]`, writtenSoFar);
    blocks.push(``, `위 앞부분에 바로 이어서 ${nextIndex}화의 나머지를 써줘.`);
  } else {
    blocks.push(
      ``,
      last
        ? `위 이야기에 자연스럽게 이어지는 ${nextIndex}화를 시작해줘.`
        : `위 주제로 1화를 시작해줘.`
    );
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

  try {
    const firstText = buildUserText(
      body.topic.trim(),
      body.previousEpisodes,
      nextIndex,
      body.directive
    );
    const { text: firstRaw } = await generateStoryEpisode({
      systemInstruction: buildSystemInstruction(
        body.characters,
        body.universe,
        body.characterContext,
        "first"
      ),
      contents: [{ role: "user", parts: [{ text: firstText }] }],
    });
    const firstPart = firstRaw.trim();
    if (!firstPart) {
      throw new Error("이번 화를 만들어내지 못했어요. 다시 시도해 주세요.");
    }

    const secondText = buildUserText(
      body.topic.trim(),
      body.previousEpisodes,
      nextIndex,
      body.directive,
      firstPart
    );
    const { text: secondRaw } = await generateStoryEpisode({
      systemInstruction: buildSystemInstruction(
        body.characters,
        body.universe,
        body.characterContext,
        "second"
      ),
      contents: [{ role: "user", parts: [{ text: secondText }] }],
    });
    const secondPart = secondRaw.trim();
    if (!secondPart) {
      throw new Error("이번 화를 만들어내지 못했어요. 다시 시도해 주세요.");
    }

    const episode: StoryEpisode = {
      index: nextIndex,
      text: `${firstPart}\n\n${secondPart}`,
      directive: body.directive?.trim() || undefined,
    };
    return NextResponse.json({ episode });
  } catch (err) {
    return geminiErrorResponse(err);
  }
}
