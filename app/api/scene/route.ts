import type { Content } from "@google/genai";
import { NextResponse } from "next/server";
import {
  characterLines,
  generateStoryEpisode,
  geminiErrorResponse,
  worldBlock,
} from "@/lib/gemini";
import { RECAP_LIMIT, RECENT_FULL_COUNT, formatElapsedDays } from "@/lib/story";
import type {
  ArcSummary,
  CharacterProfile,
  StoryEpisode,
  Universe,
} from "@/lib/types";

export const runtime = "nodejs";
// generateStoryEpisode 안의 timeoutMs·overallDeadlineMs가 실제 안전판이다.
// 여기 숫자는 그보다 살짝 여유를 둔 값. (예전엔 "AbortError = 플랫폼이
// 강제 종료"로 오해해서 이 값을 계속 줄였는데, 실제 원인은 우리 스스로
// 건 timeoutMs가 12초로 너무 짧았던 것이었다 — 자세한 내용은
// lib/gemini.ts의 generateStoryEpisode 주석 참고.)
// overallDeadlineMs가 170초로 늘어난 만큼, 그보다 작으면 우리 코드가
// 채 에러 응답을 만들기도 전에 플랫폼이 먼저 함수를 끊어버려 클라이언트엔
// 원인불명의 "네트워크 문제"로만 보인다 — 그래서 이 값도 같이 늘렸다.
// (호스팅 플랫폼이 실제로 이보다 짧게 강제 종료한다면, 지금까지와는
// 다른 — 이 코드가 직접 만든 것이 아닌 — 에러 메시지가 나타날 것이다.)
export const maxDuration = 190;

interface SceneRequestBody {
  characters: CharacterProfile[];
  universe: Universe;
  topic: string;
  previousEpisodes?: StoryEpisode[];
  /** 시작할 때 한 번 가져온 등장인물들의 1:1 대화 요약 (있으면 매 화 계속 같이 보냄) */
  characterContext?: string;
  /** RECENT_FULL_COUNT+RECAP_LIMIT화보다 오래돼 컨텍스트에서 빠진 화들을
   *  묶어 압축한 구간 요약들(오래된 순). lib/story.ts의 nextArcRange 참고 */
  arcSummaries?: ArcSummary[];
  /** 사용자가 이번 화에 반드시 들어가길 바라는 사건 한 줄 (없으면 자유 전개) */
  directive?: string;
  /** 이야기 시작 시점으로부터 지금까지 흐른 시간(일 단위 누적). 구간
   *  요약으로 압축돼도 사라지지 않도록 있으면 매 화 프롬프트에 명시적으로
   *  포함한다. */
  elapsedDays?: number;
  /** 관계·감정·외형·비밀·목표 등 "지금 상태"를 담은 내부 기록(있으면).
   *  구간 요약과 달리 압축되지 않고 항상 최신 값 그대로 매 화 프롬프트에
   *  재주입된다. lib/types.ts의 ObservationSession.currentState 참고. */
  currentState?: string;
}

/** AI 응답에서 화 본문과 "지금 상태" 기록을 나누는 구분자. 본문을 다
 *  쓴 뒤 이 줄만 단독으로 쓰고 그 아래에 상태를 적으라고 지시한다. */
const STATE_DELIMITER = "###STATE###";

/** 앞선 화들을 매번 전문으로 다시 보내면 갈수록 느려지니, 최근 몇 화만
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

  const isAU = universe.type === "au";
  blocks.push(
    `[등장 인물]\n` +
      characters
        .map(
          (c) =>
            `- ${c.name} -\n` +
            characterLines(c, isAU)
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
      `[등장 인물]의 "말투" 항목에 실제 말버릇 예시 문장(어미, 즐겨 쓰는 표현 등)이 적혀 있다면, 그 문장을 그대로 복사해 넣지 말고 그 어미·어휘 패턴만 참고해서 매번 그 장면 내용에 맞는 새 대사를 쓴다. 상황에 안 맞는데도 예시 문장이나 그 안의 특정 표현을 그대로 가져다 쓰지 않는다.`,
    ].join("\n")
  );

  blocks.push(
    [
      `[규칙]`,
      `분량은 공백 포함 3000~3600자 내외로 쓴다.`,
      `인물들은 서로에게만 말하고, 독자를 의식하거나 독자에게 말을 걸지 않는다.`,
      `이번 화 안에서도 하나의 짧은 흐름을 갖되, 이야기를 완전히 매듭짓지 말고 다음 화가 자연스럽게 이어질 수 있게 여운을 남기며 끝낸다.`,
      `사용자가 [다음 화 지시]를 줬다면 그 사건이 이번 화 안에서 분명히 일어나게 하되, 그 사건에 이르는 과정·전후 전개·세부 묘사는 자유롭게 창작한다.`,
      `대사의 말투(자주 쓰는 어미·화법)는 앞선 화들의 흐름과 무관하게 위 [등장 인물] 항목에 적힌 원래 말투를 매번 기준으로 삼는다. 특히 앞선 화들의 전문을 읽고 나면 그 화들에서 굳어진 말투를 무의식적으로 따라가기 쉬운데, 말투가 원래 설정과 조금이라도 달라졌다면 반드시 원래 말투 쪽으로 되돌아온다. 단, 사용자가 [다음 화 지시]로 특정 인물의 말투를 명시적으로 바꿔달라고 요청했다면 그 지시를 우선한다 — 이 경우엔 원래 말투로 되돌리지 않고, 지시받은 새 말투를 그 화부터 새 기준으로 삼는다.`,
      `반면 인물의 성격·감정 상태·서로에 대한 태도·관계는 말투와 다르게 이야기가 진행되며 실제로 조금씩 바뀔 수 있다. [등장 인물]에 적힌 성격은 이야기 시작 시점의 모습일 뿐, 화가 거듭돼도 고정된 값이 아니다. [지난 구간 요약]·[지금까지의 줄거리]·[최근 화 전문]에서 이미 일어난 사건들이 쌓아온 변화(성격이 누그러지거나 날카로워짐, 감정, 관계 등)를 그대로 유지하며 계속 발전시킨다. 다만 근거 없이 갑자기 다른 사람처럼 바뀌지는 않고, 그동안 벌어진 사건으로 자연스럽게 설명되는 변화여야 한다.`,
      `인물의 외형(나이 든 모습, 헤어스타일, 부상·흉터, 옷차림 등)도 성격과 마찬가지로 [등장 인물]에 적힌 모습이 이야기 시작 시점 기준일 뿐, 고정값이 아니다. 특히 아래 [이야기 속 경과 시간]에 의미 있는 시간(몇 달 이상)이 흘렀다면, 그 시간에 맞게 인물의 외형이나 처한 상황이 자연스럽게 달라졌는지 신경 써서 반영한다. 역시 근거 없이 갑자기 바뀌지는 않고, 경과 시간이나 그동안 벌어진 사건으로 설명되는 변화여야 한다.`,
      `설정에 없는 부분은 각 인물의 성격에 맞게 자연스럽게 채우되 세계관과 모순되지 않게 한다.`,
    ].join("\n")
  );

  blocks.push(
    [
      `[출력 형식]`,
      `먼저 소설 본문 텍스트만 쓴다. 제목, 화수 표시("1화" 등), 설명, 마크다운 기호 없이 본문 문단만 쓴다.`,
      `본문을 다 쓴 다음, 새 줄에 정확히 "${STATE_DELIMITER}"만 단독으로 쓰고, 그 아래에 지금 이야기 상태를 항목별로 간결하게(서술형 문장이 아니라 개조식으로) 적는다:`,
      `- 인물 간 관계: (조합마다 지금 관계·감정)`,
      `- 인물별 성격·감정 상태`,
      `- 인물별 외형·부상·복장`,
      `- 현재 위치/상황`,
      `- 각 인물이 알고 있는 정보(비밀 등)`,
      `- 진행 중인 목표`,
      `- 아직 해결되지 않은 약속·복선`,
      `- 되돌릴 수 없는 주요 사건(있다면)`,
      `[현재 상태]로 이전 값이 주어졌다면 그걸 기준으로 이번 화에서 실제로 달라진 항목만 갱신하고, 안 바뀐 항목은 이전 값을 그대로 옮겨 적는다(비워두거나 생략하지 않는다). 이 블록은 독자에게 보이는 본문이 아니라 다음 화를 쓸 때 참고할 내부 기록이다.`,
    ].join("\n")
  );

  return blocks.join("\n\n");
}

function buildUserText(
  topic: string,
  previousEpisodes: StoryEpisode[] | undefined,
  nextIndex: number,
  arcSummaries: ArcSummary[] | undefined,
  directive?: string,
  elapsedDays?: number,
  currentState?: string
): string {
  const all = previousEpisodes ?? [];
  const recentFull = all.slice(-RECENT_FULL_COUNT);
  // 구간 요약(arcSummaries)은 ARC_CHUNK_SIZE화씩 모여야 한 번 생성되니,
  // 마지막 구간 요약이 끝난 지점(coveredThrough)과 최근 화 전문이
  // 시작되는 지점 사이에 최대 ARC_CHUNK_SIZE-1화만큼 "아직 구간
  // 요약에도, 최근 N화 목록에도 안 걸리는" 화가 생길 수 있었다 —
  // 그 화들은 어디에도 언급되지 않아 통째로 사라진 것처럼 보였다.
  // RECAP_LIMIT로 고정폭을 자르는 대신 coveredThrough까지 창을 넓혀서
  // 그 구간을 [지금까지의 줄거리] 한 줄 요약으로라도 반드시 덮는다
  // (추가 Gemini 호출 없이 문자열 슬라이싱만 늘어나는 정도라 비용은 거의 없다).
  const coveredThrough =
    arcSummaries && arcSummaries.length > 0
      ? Math.max(...arcSummaries.map((a) => a.toIndex))
      : 0;
  const normalRecapStart = all.length - RECENT_FULL_COUNT - RECAP_LIMIT;
  const earlierStart = Math.max(0, Math.min(coveredThrough, normalRecapStart));
  const earlier = all.slice(earlierStart, Math.max(0, all.length - RECENT_FULL_COUNT));
  // 1화를 시작할 때만 주제 원문을 보여준다. 화가 하나라도 쌓인 뒤에는
  // 이 원문을 계속 반복해서 보여주지 않는다 — "참고만 하라"는 안내문을
  // 덧붙여도 매 화 프롬프트 맨 앞에 반복 노출되는 것 자체가 강한 앵커가
  // 돼서 이야기를 자꾸 그 시작 시점으로 끌어당기는 문제가 있었다. 이후
  // 화부터는 [지난 구간 요약]·[지금까지의 줄거리]·[최근 화 전문]이
  // 이야기의 현재 상태를 그 자체로 충분히 보여준다.
  const blocks: string[] = all.length === 0 ? [`주제: ${topic}`] : [];

  // 구간 요약으로 압축돼도 사라지지 않도록, 경과 시간이 있으면 매 화
  // 명시적으로 다시 보여준다(한 번 지시문으로만 흘려보내면 화가 쌓이면서
  // 흐려질 수 있다).
  if (elapsedDays && elapsedDays > 0) {
    blocks.push(
      ``,
      `[이야기 속 경과 시간]`,
      `이야기가 시작된 시점으로부터 지금까지 총 ${formatElapsedDays(elapsedDays)}이 지났다.`
    );
  }

  // 구간 요약과 달리 압축을 거치지 않는 값이라, 화가 아무리 쌓여도
  // 항상 최신 상태 그대로 매 화 다시 보여준다.
  if (currentState?.trim()) {
    blocks.push(``, `[현재 상태]`, currentState.trim());
  }

  if (arcSummaries && arcSummaries.length > 0) {
    blocks.push(
      ``,
      `[지난 구간 요약]`,
      ...arcSummaries.map((a) => `- ${a.fromIndex}~${a.toIndex}화: ${a.summary}`)
    );
  }

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

  if (recentFull.length > 0) {
    blocks.push(``, `[최근 ${recentFull.length}화 전문]`);
    for (const e of recentFull) {
      blocks.push(``, `(${e.index}화)`, e.text);
    }
  }

  if (directive?.trim()) {
    blocks.push(``, `[다음 화 지시]`, directive.trim());
  }

  if (recentFull.length > 0) {
    blocks.push(
      ``,
      `방금 읽은 전문들의 말투가 아니라, 시스템 지시에 있는 [등장 인물]의 말투 설정(예시 문장이 있다면 그 어미·어휘 패턴)을 기준으로 대사를 써줘. 예시 문장 자체를 상황과 무관하게 그대로 끌어다 쓰지는 마. 단, 위 [다음 화 지시]에서 말투를 바꿔달라고 명시적으로 요청했다면 그 지시대로 새 말투를 써줘.`
    );
  }

  blocks.push(
    ``,
    recentFull.length > 0
      ? `위 이야기에 자연스럽게 이어지는 ${nextIndex}화를 써줘.`
      : `위 주제로 1화를 시작해줘.`
  );

  return blocks.join("\n").replace(/^\n+/, "");
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
    nextIndex,
    body.arcSummaries,
    body.directive,
    body.elapsedDays,
    body.currentState
  );
  const contents: Content[] = [{ role: "user", parts: [{ text: userText }] }];

  try {
    const { text, model, keyIndex } = await generateStoryEpisode({
      systemInstruction: buildSystemInstruction(
        body.characters,
        body.universe,
        body.characterContext
      ),
      contents,
    });
    const trimmed = text.trim();
    // AI가 본문 뒤에 붙인 "지금 상태" 기록을 분리해낸다. 구분자가 안
    // 보이면(모델이 지시를 안 따랐거나 실패) 전체를 본문으로 취급하고
    // 상태는 갱신하지 않는다 — 잘못된 빈 값으로 기존 상태를 덮어써서
    // 지워버리지 않기 위해서다.
    const delimIndex = trimmed.indexOf(STATE_DELIMITER);
    const episodeText =
      delimIndex === -1 ? trimmed : trimmed.slice(0, delimIndex).trim();
    const parsedState =
      delimIndex === -1
        ? undefined
        : trimmed.slice(delimIndex + STATE_DELIMITER.length).trim() || undefined;
    if (!episodeText) {
      throw new Error("이번 화를 만들어내지 못했어요. 다시 시도해 주세요.");
    }
    const episode: StoryEpisode = {
      index: nextIndex,
      text: episodeText,
      directive: body.directive?.trim() || undefined,
      model,
      keyIndex,
    };
    return NextResponse.json({ episode, currentState: parsedState });
  } catch (err) {
    return geminiErrorResponse(err);
  }
}
