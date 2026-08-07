// Gemini API 호출 공통 로직. 이 파일은 서버(Route Handler)에서만 import한다.
import { ApiError, GoogleGenAI, Type, type Content } from "@google/genai";
import type { CharacterProfile, World } from "./types";

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

let client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiRequestError(
      "서버에 GEMINI_API_KEY가 설정되어 있지 않아요. Vercel 환경 변수를 확인해 주세요.",
      "unknown"
    );
  }
  if (!client) {
    client = new GoogleGenAI({ apiKey });
  }
  return client;
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

/** 세계관 + 관계 인물을 시스템 프롬프트용 텍스트로 합친다 */
export function worldBlock(world: World): string {
  const parts: string[] = [];
  if (world.worldSetting.trim()) {
    parts.push(`[세계관]\n${world.worldSetting.trim()}`);
  }
  if (world.relatedPeople.trim()) {
    parts.push(`[관계 인물]\n${world.relatedPeople.trim()}`);
  }
  return parts.join("\n\n");
}

async function generate(params: {
  systemInstruction: string;
  contents: Content[];
  json?: boolean;
}): Promise<string> {
  const ai = getClient();
  try {
    const response = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: params.contents,
      config: {
        systemInstruction: params.systemInstruction,
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
                minItems: "10",
                maxItems: "14",
              },
            }
          : {}),
      },
    });
    const text = response.text;
    if (!text) {
      throw new GeminiRequestError(
        "AI가 빈 응답을 보냈어요. 다시 시도해 주세요.",
        "unknown"
      );
    }
    return text;
  } catch (err) {
    if (err instanceof GeminiRequestError) throw err;
    if (err instanceof ApiError) {
      if (err.status === 429) {
        throw new GeminiRequestError(
          "오늘 사용량을 다 썼어요. 잠시 후 다시 시도해 주세요.",
          "quota"
        );
      }
      throw new GeminiRequestError(
        `AI 호출 중 문제가 생겼어요. (${err.status})`,
        "unknown"
      );
    }
    throw new GeminiRequestError(
      "네트워크 문제로 AI를 호출하지 못했어요. 다시 시도해 주세요.",
      "network"
    );
  }
}

export async function generateChatReply(params: {
  systemInstruction: string;
  contents: Content[];
}): Promise<string> {
  return generate({ ...params, json: false });
}

export async function generateSceneJson(params: {
  systemInstruction: string;
  contents: Content[];
}): Promise<string> {
  return generate({ ...params, json: true });
}
