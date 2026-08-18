// Gemini 모델 ID를 화면에 보여줄 짧은 이름으로 바꾼다.
// 서버(lib/gemini.ts)와 클라이언트(채팅 화면) 양쪽에서 쓰므로
// "@google/genai"를 import하지 않는 순수 유틸로 분리한다.
const MODEL_LABELS: Record<string, string> = {
  "gemini-3.6-flash": "Gemini 3.6 Flash",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-3-flash-preview": "Gemini 3 Flash Preview",
  "gemini-3.5-flash": "Gemini 3.5 Flash",
  "gemini-3.5-flash-lite": "Gemini 3.5 Flash Lite",
};

export function modelLabel(id?: string): string | null {
  if (!id) return null;
  return MODEL_LABELS[id] ?? id;
}

/** "Gemini 3.6 Flash · 키1"처럼 모델 이름 뒤에 사용된 API 키 번호까지 붙인다 */
export function sourceLabel(id?: string, keyIndex?: number): string | null {
  const label = modelLabel(id);
  if (!label) return null;
  return keyIndex ? `${label} · 키${keyIndex}` : label;
}
