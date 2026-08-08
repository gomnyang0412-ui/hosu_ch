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
// 맞게, 이 카테고리들은 걸러내지 않도록 최대한 완화한다.
const SAFETY_SETTINGS: SafetySetting[] = [
  HarmCategory.HARM_CATEGORY_HARASSMENT,
  HarmCategory.HARM_CATEGORY_HATE_SPEECH,
  HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
  HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
].map((category) => ({
  category,
  threshold: HarmBlockThreshold.BLOCK_NONE,
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

// "-latest" 별칭을 쓰면 Google이 모델을 교체해도(2주 전 안내) 여기를 계속
// 고칠 필요가 없다. 특정 모델명을 고정하면 그 모델이 만료됐을 때 404가 난다.
export const GEMINI_MODEL = "gemini-flash-latest";

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
// chat/thread-chat 라우트는 이 호출을 최대 2번(재시도 포함) 할 수 있으니,
// 그 라우트들의 maxDuration(60초) 안에 여유 있게 들어가도록 잡는다.
const CALL_TIMEOUT_MS = 28_000;

async function generate(params: {
  systemInstruction: string;
  contents: Content[];
  json?: boolean;
  itemRange?: { min: number; max: number };
}): Promise<string> {
  const clients = getClients();
  let lastError: GeminiRequestError | null = null;
  const { min: minItems, max: maxItems } = params.itemRange ?? {
    min: 10,
    max: 14,
  };

  for (const ai of clients) {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: params.contents,
        config: {
          abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
          systemInstruction: params.systemInstruction,
          safetySettings: SAFETY_SETTINGS,
          ...(params.json
            ? {
                responseMimeType: "application/json",
                responseSchema: {
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
      const mapped = toGeminiError(err);
      // 사용량 초과가 아닌 오류는 다른 키로 시도해도 똑같이 실패할 가능성이
      // 높으니 바로 실패 처리한다. 사용량 초과일 때만 다음 키로 넘어간다.
      if (mapped.kind !== "quota") throw mapped;
      lastError = mapped;
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

/** 1:1 대화 응답 (지문+대사 혼합, 보통 1~4개 항목) */
export async function generateChatJson(params: {
  systemInstruction: string;
  contents: Content[];
}): Promise<string> {
  return generate({ ...params, json: true, itemRange: { min: 1, max: 4 } });
}

/** 관찰 모드 장면 (지문+대사, 10~14개 항목) */
export async function generateSceneJson(params: {
  systemInstruction: string;
  contents: Content[];
}): Promise<string> {
  return generate({ ...params, json: true, itemRange: { min: 10, max: 14 } });
}

/** 멀티 대화방 응답 (지문+대사, 보통 1~6개 항목) */
export async function generateThreadJson(params: {
  systemInstruction: string;
  contents: Content[];
}): Promise<string> {
  return generate({ ...params, json: true, itemRange: { min: 1, max: 6 } });
}
