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
  "gemini-3-flash",
  "gemini-3.5-flash",
];
// 요약(기억 정리)은 뉘앙스보다 사실 정리가 중요해 처음부터 가볍고 RPD가
// 넉넉한 Lite만 쓴다 — Flash 한도를 대사 생성 쪽에 아껴두는 목적도 있다.
const LITE_MODEL = "gemini-3.5-flash-lite";
const DIALOGUE_MODEL_CHAIN = [...DIALOGUE_MODELS, LITE_MODEL];

export type GeminiErrorKind = "quota" | "network" | "unknown";

export class GeminiRequestError extends Error {
  kind: GeminiErrorKind;
  constructor(message: string, kind: GeminiErrorKind) {
    super(message);
    this.name = "GeminiRequestError";
    this.kind = kind;
  }
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
    return new GeminiRequestError(
      `AI 호출 중 문제가 생겼어요. (${err.status})`,
      "unknown"
    );
  }
  // AbortSignal.timeout()이 걸리면 DOMException(name: "TimeoutError")이 온다.
  if (err instanceof Error && err.name === "TimeoutError") {
    return new GeminiRequestError(
      "AI 응답이 너무 오래 걸려서 중단했어요. 다시 시도해 주세요.",
      "network"
    );
  }
  return new GeminiRequestError(
    "네트워크 문제로 AI를 호출하지 못했어요. 다시 시도해 주세요.",
    "network"
  );
}

/** 캐릭터 설정을 시스템 프롬프트용 줄 단위 텍스트로 바꾼다 (빈 항목은 제외) */
export function characterLines(c: CharacterProfile): string[] {
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
// 1:1 대화는 대사 검증에 실패하면 최대 2번까지 순차 호출할 수 있으니,
// 그 라우트의 maxDuration(60초) 안에 여유 있게 들어가도록 잡는다.
const CALL_TIMEOUT_MS = 25_000;

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

async function generate(params: {
  systemInstruction: string;
  contents: Content[];
  json?: boolean;
  itemRange?: { min: number; max: number };
  singleReply?: boolean;
  /** 시도할 모델을 우선순위 순서대로. 앞 모델이 전체 키에서 quota로
   *  실패하면 다음 모델로 넘어간다. */
  models: string[];
}): Promise<string> {
  const clients = getClients();
  let lastError: GeminiRequestError | null = null;
  const { min: minItems, max: maxItems } = params.itemRange ?? {
    min: 10,
    max: 14,
  };

  for (const model of params.models) {
    for (const ai of clients) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: params.contents,
          config: {
            abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
            systemInstruction: params.systemInstruction,
            safetySettings: SAFETY_SETTINGS,
            ...(params.json
              ? {
                  responseMimeType: "application/json",
                  responseSchema: params.singleReply
                    ? SINGLE_REPLY_SCHEMA
                    : {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            t: { type: Type.STRING, enum: ["n", "d"] },
                            text: { type: Type.STRING },
                            who: { type: Type.STRING },
                            act: { type: Type.STRING },
                            say: { type: Type.STRING },
                          },
                          required: ["t"],
                        },
                        minItems: String(minItems),
                        maxItems: String(maxItems),
                      },
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
        return text;
      } catch (err) {
        if (isModelUnavailable(err)) break; // 이 모델 자체가 없음 → 바로 다음 모델로
        const mapped = toGeminiError(err);
        // 사용량 초과가 아닌 오류는 다른 키/모델로 시도해도 똑같이 실패할
        // 가능성이 높으니 바로 실패 처리한다. 사용량 초과일 때만 다음
        // 키로, 그것도 다 떨어지면 다음 모델로 넘어간다.
        if (mapped.kind !== "quota") throw mapped;
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

/** 1:1 대화 응답 (지문 + 대사 한 쌍. say는 스키마상 필수) */
export async function generateChatReply(params: {
  systemInstruction: string;
  contents: Content[];
}): Promise<string> {
  return generate({
    ...params,
    json: true,
    singleReply: true,
    models: DIALOGUE_MODEL_CHAIN,
  });
}

/** 관찰 모드 장면 (지문+대사, 10~14개 항목) */
export async function generateSceneJson(params: {
  systemInstruction: string;
  contents: Content[];
}): Promise<string> {
  return generate({
    ...params,
    json: true,
    itemRange: { min: 10, max: 14 },
    models: DIALOGUE_MODEL_CHAIN,
  });
}

/** 멀티 대화방 응답 (지문+대사, 보통 1~6개 항목) */
export async function generateThreadJson(params: {
  systemInstruction: string;
  contents: Content[];
}): Promise<string> {
  return generate({
    ...params,
    json: true,
    itemRange: { min: 1, max: 6 },
    models: DIALOGUE_MODEL_CHAIN,
  });
}

/** 1:1 대화 기록을 짧은 지문으로 요약하는 평문 응답 (JSON 아님) */
export async function generateSummaryText(params: {
  systemInstruction: string;
  contents: Content[];
}): Promise<string> {
  return generate({ ...params, json: false, models: [LITE_MODEL] });
}
