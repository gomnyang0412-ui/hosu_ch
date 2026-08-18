// Gemini API 호출 공통 로직. 이 파일은 서버(Route Handler)에서만 import한다.
import {
  ApiError,
  FinishReason,
  GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  Type,
  type Content,
  type SafetySetting,
} from "@google/genai";
import { NextResponse } from "next/server";
import { recordApiUsage } from "./db";
import { todayPacific } from "./memory";
import type { CharacterProfile, Universe } from "./types";

// 캐릭터 롤플레이는 갈등·위협·권력관계 같은 긴장된 상황을 다루는 경우가
// 많은데, 기본 안전 설정은 그런 장면에서 실제 폭력·성적 콘텐츠가 전혀
// 없어도 모델이 과도하게 몸을 사려서 대사 없이 지문만 내놓거나 아예
// 응답을 끊어버릴 때가 있다. 개인용 캐릭터 롤플레이 앱이라는 용도에
// 맞게, 이 카테고리들은 필터 자체를 끈다. BLOCK_NONE은 "필터는 돌리되
// 절대 막지는 않음", OFF는 "필터 자체를 실행하지 않음"이라 한 단계 더
// 느슨하다 — 실제로 위험해서라기보다 토큰이 꼬여 필터가 오작동(환각)해
// 막히는 경우가 많아, API가 제공하는 가장 낮은 단계까지 낮춘다.
const SAFETY_SETTINGS: SafetySetting[] = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({
  category,
  threshold: HarmBlockThreshold.OFF,
}));

// 안전 필터 등으로 생성이 중간에 막혔을 때 붙는 finishReason들.
// 이 경우엔 JSON이 잘려서 파싱이 실패하는 게 당연하므로, 혼란스러운
// "형식을 이해하지 못했어요" 대신 원인을 그대로 알려준다.
const BLOCKED_FINISH_REASONS = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.BLOCKLIST,
  FinishReason.RECITATION,
  FinishReason.SPII,
]);

// "-latest" 별칭은 구글이 뒤에서 가리키는 실제 모델을 바꿀 수 있는데,
// 그러면서 무료 등급 하루 요청 한도(RPD)가 우리도 모르는 새 확 줄어드는
// 일이 실제로 있었다(3.6 Flash로 넘어가며 RPD가 20까지 떨어짐). 그래서
// 항상 구체적인 모델 이름에 고정한다.
//
// 대사 생성(1:1/관찰/멀티방)은 캐릭터 일관성·자연스러움이 중요해서
// Flash 계열을 우선 시도한다. 한 Flash 모델의 하루 요청 한도(RPD)가
// 다 떨어지면(전체 키에서 전부 quota 에러) 다음 Flash 모델로 넘어가고,
// Flash를 전부 소진하면 마지막으로 Flash-Lite까지 내려가 대화가 완전히
// 끊기지는 않게 한다.
const DIALOGUE_MODELS = [
  "gemini-3.6-flash",
  "gemini-2.5-flash",
  "gemini-3-flash-preview",
  "gemini-3.5-flash",
];
// 요약(기억 정리)은 뉘앙스보다 사실 정리가 중요해 처음부터 가볍고 RPD가
// 넉넉한 Lite만 쓴다 — Flash 한도를 대사 생성 쪽에 아껴두는 목적도 있다.
const LITE_MODEL = "gemini-3.5-flash-lite";
const DIALOGUE_MODEL_CHAIN = [...DIALOGUE_MODELS, LITE_MODEL];

export type GeminiErrorKind = "quota" | "network" | "overloaded" | "unknown";

export class GeminiRequestError extends Error {
  kind: GeminiErrorKind;
  constructor(message: string, kind: GeminiErrorKind) {
    super(message);
    this.name = "GeminiRequestError";
    this.kind = kind;
  }
}

/**
 * Gemini를 호출하는 모든 Route Handler의 공통 에러 응답. 각 라우트가
 * 거의 똑같은 catch 블록을 따로 들고 있던 걸 여기 하나로 모았다.
 */
export function geminiErrorResponse(err: unknown): NextResponse {
  if (err instanceof GeminiRequestError) {
    const status =
      err.kind === "quota" ? 429 : err.kind === "overloaded" ? 503 : 502;
    return NextResponse.json(
      { error: err.message, kind: err.kind },
      { status }
    );
  }
  return NextResponse.json(
    {
      error: err instanceof Error ? err.message : "알 수 없는 오류가 발생했어요.",
      kind: "unknown",
    },
    { status: 502 }
  );
}

let clients: GoogleGenAI[] | null = null;

// GEMINI_API_KEY에 쉼표로 여러 키를 넣으면(예: "키1,키2,키3"), 서로 다른
// 구글 계정에서 발급받은 키를 순서대로 시도한다. 앞 키의 하루 사용량이
// 다 떨어지면 자동으로 다음 키로 넘어간다.
function getClients(): GoogleGenAI[] {
  if (!clients) {
    const keys = (process.env.GEMINI_API_KEY ?? "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    if (keys.length === 0) {
      throw new GeminiRequestError(
        "서버에 GEMINI_API_KEY가 설정되어 있지 않아요. Vercel 환경 변수를 확인해 주세요.",
        "unknown"
      );
    }
    clients = keys.map((apiKey) => new GoogleGenAI({ apiKey }));
  }
  return clients;
}

// 모델 이름 자체가 이 계정/리전에서 아직 제공되지 않을 때 API가 돌려주는
// 상태코드. quota 초과와는 다른 이유지만, 마찬가지로 "이 모델은 포기하고
// 다음 모델로 넘어가면 되는" 상황이라 quota와 똑같이 취급한다 — 그래야
// 존재하지 않는 모델 이름 하나 때문에 체인 전체(결국 항상 되는 Lite까지)가
// 끊기지 않는다.
function isModelUnavailable(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

function toGeminiError(err: unknown): GeminiRequestError {
  if (err instanceof GeminiRequestError) return err;
  if (err instanceof ApiError) {
    if (err.status === 429) {
      return new GeminiRequestError(
        "오늘 사용량을 다 썼어요. 잠시 후 다시 시도해 주세요.",
        "quota"
      );
    }
    // 503(UNAVAILABLE)·500은 이 키·계정의 문제가 아니라 구글 쪽 모델
    // 서버가 일시적으로 혼잡한 것이다. 다른 모델·키로 넘어가면 될
    // 확률이 높으니 quota와 똑같이 "다음으로 넘어가도 되는" 오류로
    // 취급한다.
    if (err.status === 503 || err.status === 500) {
      return new GeminiRequestError(
        "AI 서버가 지금 일시적으로 혼잡해요. 잠시 후 다시 시도해 주세요.",
        "overloaded"
      );
    }
    return new GeminiRequestError(
      `AI 호출 중 문제가 생겼어요. (${err.status})`,
      "unknown"
    );
  }
  // AbortSignal.timeout()이 걸리면 스펙상 DOMException(name: "TimeoutError")이
  // 와야 하지만, Node의 fetch(undici) 구현은 신호의 reason을 그대로 넘기지
  // 않고 자체적으로 이름 없는 "AbortError"를 던지는 경우가 있다 — 실제로
  // 우리 쪽 timeoutMs가 너무 짧게 잡혀 있어서(예전 12초) 매번 우리 스스로
  // 건 타임아웃에 걸리는 것이었는데, 그게 "AbortError: This operation was
  // aborted"로만 보여서 마치 호스팅 플랫폼이 함수를 강제 종료한 것처럼
  // 오해하기 쉬웠다. 그래서 이름 없는 AbortError도 우리 자신의 타임아웃과
  // 똑같이 취급한다.
  if (
    err instanceof Error &&
    (err.name === "TimeoutError" || err.name === "AbortError")
  ) {
    return new GeminiRequestError(
      "AI 응답이 너무 오래 걸려서 중단했어요. 다시 시도해 주세요.",
      "network"
    );
  }
  // 여기까지 왔다는 건 quota·overloaded·timeout 중 어디에도 안 걸리는
  // 예외라는 뜻이라, 원인을 계속 추측만 하기보다 실제 예외 정보를 메시지에
  // 그대로 남겨서 다음에 뜰 때 바로 원인을 알 수 있게 한다.
  const detail =
    err instanceof Error
      ? `${err.name}: ${err.message}`
      : typeof err === "string"
        ? err
        : (() => {
            try {
              return JSON.stringify(err);
            } catch {
              return String(err);
            }
          })();
  return new GeminiRequestError(
    `네트워크 문제로 AI를 호출하지 못했어요. (${detail}) 다시 시도해 주세요.`,
    "network"
  );
}

/**
 * 캐릭터 설정을 시스템 프롬프트용 줄 단위 텍스트로 바꾼다 (빈 항목은 제외).
 *
 * isAU가 true면(원작이 아닌 다른 세계관) 목표·배경 이야기·살아온 궤적·연관
 * 인물·애정 관계처럼 "원작 맥락"에 묶인 항목은 뺀다 — worldBlock()이 이미
 * AU 세계관에 맞게 상황과 관계를 재해석해서 연기하라고 지시하는데, 원작의
 * 구체적인 인생사·인간관계까지 같이 던져주면 그 지시와 충돌해서 캐릭터가
 * 원작 설정과 AU 설정 사이에서 어색하게 겹쳐 보인다. 이름과 근본적인
 * 성격·말투만 유지한 채 나머지는 AU 세계관 쪽 설정(worldBlock)이 채우게 한다.
 */
export function characterLines(c: CharacterProfile, isAU = false): string[] {
  if (isAU) {
    return [
      `이름: ${c.name}`,
      c.personality ? `성격: ${c.personality}` : "",
      c.speechStyle ? `말투: ${c.speechStyle}` : "",
    ].filter(Boolean);
  }
  return [
    `이름: ${c.name}`,
    c.oneLiner ? `한 줄 소개: ${c.oneLiner}` : "",
    c.goal ? `목표: ${c.goal}` : "",
    c.appearance ? `외형 특징: ${c.appearance}` : "",
    c.scentNote ? `향 노트: ${c.scentNote}` : "",
    c.personality ? `성격: ${c.personality}` : "",
    c.speechStyle ? `말투: ${c.speechStyle}` : "",
    c.background ? `배경 이야기: ${c.background}` : "",
    c.lifeHistory ? `살아온 궤적: ${c.lifeHistory}` : "",
    c.relatedCharacters ? `연관 인물: ${c.relatedCharacters}` : "",
    c.romance ? `애정 관계: ${c.romance}` : "",
  ].filter(Boolean);
}

/** 세계관(유니버스) 설정을 시스템 프롬프트용 텍스트로 합친다 */
export function worldBlock(universe: Universe): string {
  const parts: string[] = [];
  if (universe.type === "au") {
    parts.push(
      [
        `[세계관 종류]`,
        `이건 오리지널 설정이 아니라 "${universe.title}"라는 AU(다른 세계관)다.`,
        `아래 세계관 설정을 기준으로 하되, 인물의 이름과 근본적인 성격의 뿌리는 유지하면서`,
        `이 세계관에 맞게 상황과 관계를 재해석해서 연기한다.`,
      ].join("\n")
    );
  }
  if (universe.worldSetting.trim()) {
    parts.push(`[세계관]\n${universe.worldSetting.trim()}`);
  }
  if (universe.faction?.trim()) {
    parts.push(`[파벌]\n${universe.faction.trim()}`);
  }
  const relationLines = (universe.relations ?? [])
    .map((r, i) => (r?.trim() ? `- 관계 ${i + 1}: ${r.trim()}` : ""))
    .filter(Boolean);
  if (relationLines.length > 0) {
    parts.push(`[관계]\n${relationLines.join("\n")}`);
  }
  if (universe.glossary?.trim()) {
    parts.push(`[용어 및 설정]\n${universe.glossary.trim()}`);
  }
  if (universe.summary?.trim()) {
    parts.push(`[요약]\n${universe.summary.trim()}`);
  }
  return parts.join("\n\n");
}

// Gemini 호출 한 번이 이 시간을 넘기면 응답을 무한정 기다리지 않고
// 바로 실패 처리해서, 사용자가 "입력 중…" 상태로 무한정 갇히지 않게 한다.
// 처음엔 25초였는데, Flash 모델이 그 안에 못 끝내는 경우가 실제로
// 10번 중 2~3번꼴로 있었다(반응 단계에서 먼저 확인됐지만, 이 기본값을
// 그대로 쓰는 지정 대상 응답(generateChatReply)에서도 똑같이 벌어지는
// 문제였다). 그래서 35초로 늘렸다. 1:1/멀티 대화는 대사 검증에
// 실패하면 최대 2번까지 순차 호출할 수 있으니, 그 라우트의
// maxDuration 안에 여유 있게 들어가도록 호출부 쪽 maxDuration도
// 같이 맞춰뒀다.
const CALL_TIMEOUT_MS = 35_000;

// 1:1 대화 한 턴의 응답 스키마. 배열이 아니라 객체 하나라서, "say"가
// 스키마상 필수 필드가 된다 — 지문(narration)만 있고 대사가 아예
// 없는 응답 자체가 구조적으로 나올 수 없다.
const SINGLE_REPLY_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    narration: { type: Type.STRING },
    act: { type: Type.STRING },
    say: { type: Type.STRING },
  },
  required: ["say"],
};

// 캐릭터 설정 항목별 제안. 대화 근거가 없는 항목은 빈 문자열로 둘 수
// 있어야 해서 required는 없다.
const CHARACTER_PROFILE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    oneLiner: { type: Type.STRING },
    goal: { type: Type.STRING },
    appearance: { type: Type.STRING },
    scentNote: { type: Type.STRING },
    personality: { type: Type.STRING },
    speechStyle: { type: Type.STRING },
    background: { type: Type.STRING },
    lifeHistory: { type: Type.STRING },
    relatedCharacters: { type: Type.STRING },
    romance: { type: Type.STRING },
    firstMessage: { type: Type.STRING },
  },
};

async function generate(params: {
  systemInstruction: string;
  contents: Content[];
  json?: boolean;
  /** 기본 SINGLE_REPLY_SCHEMA 대신 쓸 커스텀 스키마 */
  responseSchema?: object;
  /** 시도할 모델을 우선순위 순서대로. 앞 모델이 전체 키에서 quota로
   *  실패하면 다음 모델로 넘어간다. */
  models: string[];
  /** 기본 CALL_TIMEOUT_MS보다 더 오래 걸리는 호출(예: 5000자짜리 소설 한 화)을 위한 개별 타임아웃 */
  timeoutMs?: number;
  /**
   * 타임아웃뿐 아니라 순수 연결 오류(toGeminiError가 둘 다 "network"로
   * 분류한다)도 quota/overloaded처럼 다음 키·모델로 넘어가게 할지.
   * 기본은 false다 — 이미 호출부 자체가(1:1/멀티 대화) 빈 응답이면 한
   * 번 더 부르는 재시도를 갖고 있어서, 여기서도 매 모델마다 재시도하면
   * 총 대기시간이 라우트의 maxDuration을 넘어버릴 수 있다. 한 번의
   * 호출만 하는 관찰 모드 화 생성처럼, 모델 하나가 안 되도 다른
   * 모델·키를 마저 시도해볼 여유가 있는 경우에만 켠다(대신
   * overallDeadlineMs로 총 시간은 여전히 제한해야 한다).
   */
  retryOnTimeout?: boolean;
  /**
   * 모델·키를 넘나드는 재시도 전체에 거는 총 시간 제한. 호스팅 플랫폼의
   * 실제 함수 실행 제한은 코드의 maxDuration 설정과 별개로 더 짧을 수
   * 있어서(예: Vercel 무료 플랜은 maxDuration을 몇 초로 적든 실제로는
   * 훨씬 짧게 끊는다), 그 벽에 걸려 응답 자체를 못 돌려주고 죽는 것보다
   * 이 시간이 되면 지금까지의 오류로 깔끔하게 실패 응답을 주는 게 낫다.
   */
  overallDeadlineMs?: number;
}): Promise<{ text: string; model: string; keyIndex: number }> {
  const clients = getClients();
  let lastError: GeminiRequestError | null = null;
  const startedAt = Date.now();

  for (const model of params.models) {
    for (let i = 0; i < clients.length; i++) {
      // 이미 지난 시간만 보면 안 된다 — 지금 막 시작하는 시도가 자기
      // timeoutMs를 다 채우고 나면 그때 가서야 예산을 넘긴 걸 알게 되고,
      // 그 사이 route의 maxDuration을 플랫폼이 먼저 강제 종료해서 우리
      // 코드가 에러 응답을 만들 기회조차 없이 연결이 끊겨버린다(클라이언트엔
      // 원인불명의 "네트워크 문제"로 보임). 그래서 이번 시도가 최악의 경우
      // timeoutMs만큼 다 써도 남은 예산 안에 들어올 때만 시작한다.
      const nextCallBudget = params.timeoutMs ?? CALL_TIMEOUT_MS;
      if (
        params.overallDeadlineMs &&
        Date.now() - startedAt + nextCallBudget > params.overallDeadlineMs
      ) {
        throw (
          lastError ??
          new GeminiRequestError(
            "AI 응답이 너무 오래 걸려서 중단했어요. 다시 시도해 주세요.",
            "network"
          )
        );
      }
      const ai = clients[i];
      try {
        const response = await ai.models.generateContent({
          model,
          contents: params.contents,
          config: {
            abortSignal: AbortSignal.timeout(params.timeoutMs ?? CALL_TIMEOUT_MS),
            systemInstruction: params.systemInstruction,
            safetySettings: SAFETY_SETTINGS,
            ...(params.json
              ? {
                  responseMimeType: "application/json",
                  responseSchema: params.responseSchema ?? SINGLE_REPLY_SCHEMA,
                }
              : {}),
          },
        });
        const finishReason = response.candidates?.[0]?.finishReason;
        if (finishReason && BLOCKED_FINISH_REASONS.has(finishReason)) {
          throw new GeminiRequestError(
            "AI 안전 정책에 걸려 이 내용을 만들지 못했어요. 표현을 조금 바꿔서 다시 시도해 주세요.",
            "unknown"
          );
        }
        const text = response.text;
        if (!text) {
          throw new GeminiRequestError(
            "AI가 빈 응답을 보냈어요. 다시 시도해 주세요.",
            "unknown"
          );
        }
        // 서버리스 환경에서는 응답을 반환한 뒤 실행이 곧바로 얼어붙을 수
        // 있어서, fire-and-forget이 아니라 기록이 끝나길 기다린 뒤 반환한다
        // (recordApiUsage 자체는 내부에서 실패를 삼켜 절대 던지지 않는다).
        await recordApiUsage(todayPacific(), i + 1, model, "success");
        return { text, model, keyIndex: i + 1 };
      } catch (err) {
        if (isModelUnavailable(err)) break; // 이 모델 자체가 없음 → 바로 다음 모델로
        const mapped = toGeminiError(err);
        // 사용량 초과(quota)나 서버 혼잡(overloaded)이 아닌 오류는 다른
        // 키/모델로 시도해도 똑같이 실패할 가능성이 높으니 바로 실패
        // 처리한다. 이 둘일 때만, 그리고 retryOnTimeout이 켜져 있으면
        // network(타임아웃 포함 — toGeminiError는 타임아웃과 순수
        // 연결 오류를 똑같이 "network"로 분류한다)일 때도 다음 키로,
        // 그것도 다 떨어지면 다음 모델로 넘어간다.
        if (mapped.kind === "quota") {
          await recordApiUsage(todayPacific(), i + 1, model, "quota");
        }
        const retryable =
          mapped.kind === "quota" ||
          mapped.kind === "overloaded" ||
          (mapped.kind === "network" && params.retryOnTimeout);
        if (!retryable) throw mapped;
        lastError = mapped;
      }
    }
  }

  throw (
    lastError ??
    new GeminiRequestError(
      "오늘 사용량을 다 썼어요. 잠시 후 다시 시도해 주세요.",
      "quota"
    )
  );
}

// room-chat 라우트(maxDuration 80초)는 검증 실패 시 이 함수를 최대 2번
// 순차 호출할 수 있어서(app/api/room-chat/route.ts의 attemptTarget()),
// 한 번의 호출이 예산 없이 5개 모델 × 키 개수를 전부 재시도하면 두
// 번째 호출을 시작하기도 전에 route의 maxDuration을 플랫폼이 먼저
// 끊어버릴 수 있다(generateStoryEpisode에서 이미 겪은 것과 같은
// 클래스의 버그). 36초로 예산을 두면 두 번을 합쳐도 72초로 80초 안에
// 여유 있게 들어온다.
const CHAT_REPLY_DEADLINE_MS = 36_000;

/** 1:1 대화 응답 (지문 + 대사 한 쌍. say는 스키마상 필수) */
export async function generateChatReply(params: {
  systemInstruction: string;
  contents: Content[];
}): Promise<{ text: string; model: string; keyIndex: number }> {
  return generate({
    ...params,
    json: true,
    models: DIALOGUE_MODEL_CHAIN,
    overallDeadlineMs: CHAT_REPLY_DEADLINE_MS,
  });
}

// 요약 라우트(summarize/summarize-arc/summarize-story)는 모두
// maxDuration 60초에 이 함수를 한 번만 호출한다. 예산 없이 재시도하면
// (모델은 LITE_MODEL 하나뿐이지만 키가 여러 개면 그만큼 반복) 60초를
// 넘겨 플랫폼이 강제 종료할 수 있어, 12초 여유를 두고 48초로 제한한다.
const SUMMARY_DEADLINE_MS = 48_000;

/** 1:1 대화 기록을 짧은 지문으로 요약하는 평문 응답 (JSON 아님) */
export async function generateSummaryText(params: {
  systemInstruction: string;
  contents: Content[];
}): Promise<string> {
  const { text } = await generate({
    ...params,
    json: false,
    models: [LITE_MODEL],
    overallDeadlineMs: SUMMARY_DEADLINE_MS,
  });
  return text;
}

/**
 * 관찰 모드 단편소설 한 화 (평문, JSON 아님). Lite로는 캐릭터가 무너지는
 * 문제가 있어, 다른 롤플레이 생성과 똑같이 Flash 체인을 우선 쓰고 전부
 * 소진됐을 때만 Lite로 내려간다.
 *
 * "AbortError: This operation was aborted"는 호스팅 플랫폼이 함수를
 * 강제 종료해서가 아니라, 우리 스스로 건 timeoutMs가 너무 짧아서(한때
 * 12초) 실제 생성이 끝나기도 전에 우리 코드가 먼저 끊어버린 것이었다 —
 * 새로 만드는 이야기의 1화(누적 맥락이 거의 없는 가장 짧은 요청)조차
 * 똑같이 실패한 게 그 증거다. 3000자 안팎의 한국어 산문 한 화를 통째로
 * 생성하는 데는 원래 수십 초가 걸릴 수 있으니, 개별 타임아웃을 실제
 * 생성 시간에 맞게 넉넉히 주고 총 재시도 시간과 라우트의 maxDuration도
 * 그에 맞춰 늘렸다.
 *
 * overallDeadlineMs는 timeoutMs 두 번(넉넉잡아 100초)이 들어갈 만큼
 * 넉넉히 잡는다 — AU처럼 [세계관]·[관계]·[용어] 블록까지 붙어 시스템
 * 프롬프트가 큰 경우 첫 시도 자체가 timeoutMs에 가깝게 걸리는 일이
 * 흔한데, 예전처럼 여유가 거의 없으면(구 55초) generate()가 재시도를
 * 시작할지 말지 애매하게 판단하다 route의 maxDuration을 플랫폼이 먼저
 * 강제 종료해버려("네트워크 문제로 이번 화를 만들지 못했어요") 원인을
 * 알 수 없는 실패로 보였다. 지금은 generate() 쪽 예산 검사도 "이번
 * 시도가 최악의 경우 다 걸려도 남은 예산 안에 들어오는지"로 고쳐서,
 * 예산이 부족하면 아예 재시도를 시작하지 않고 바로 깔끔한 에러를
 * 던진다 — route의 maxDuration(scene/route.ts)도 이 예산보다 넉넉히
 * 크게 맞춰야 한다.
 */
export async function generateStoryEpisode(params: {
  systemInstruction: string;
  contents: Content[];
}): Promise<{ text: string; model: string; keyIndex: number }> {
  return generate({
    ...params,
    json: false,
    models: DIALOGUE_MODEL_CHAIN,
    timeoutMs: 50_000,
    retryOnTimeout: true,
    overallDeadlineMs: 100_000,
  });
}

// character-profile 라우트는 maxDuration 60초에 이 함수를 한 번만
// 호출한다. 10초 여유를 두고 50초로 제한한다.
const CHARACTER_PROFILE_DEADLINE_MS = 50_000;

/** 대화 기록을 참고해 캐릭터 설정 항목별로 다듬은 글을 제안 (JSON 객체) */
export async function generateCharacterProfile(params: {
  systemInstruction: string;
  contents: Content[];
}): Promise<{ text: string; model: string; keyIndex: number }> {
  return generate({
    ...params,
    json: true,
    responseSchema: CHARACTER_PROFILE_SCHEMA,
    models: DIALOGUE_MODEL_CHAIN,
    overallDeadlineMs: CHARACTER_PROFILE_DEADLINE_MS,
  });
}
