import type { SceneItem } from "./types";

/** Gemini가 코드블록(```json ... ```)이나 설명을 덧붙인 경우를 대비해 정리한 뒤 파싱한다 */
export function parseSceneItems(raw: string): SceneItem[] {
  let text = raw.trim();

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("장면 형식을 이해하지 못했어요.");
  }
  text = text.slice(start, end + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("장면 형식을 이해하지 못했어요.");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("장면 형식을 이해하지 못했어요.");
  }

  const items: SceneItem[] = [];
  for (const raw of parsed) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    if (item.t === "n" && typeof item.text === "string" && item.text.trim()) {
      items.push({ t: "n", text: item.text.trim() });
    } else if (
      item.t === "d" &&
      typeof item.who === "string" &&
      item.who.trim() &&
      typeof item.say === "string" &&
      item.say.trim()
    ) {
      items.push({
        t: "d",
        who: item.who.trim(),
        act:
          typeof item.act === "string" && item.act.trim()
            ? item.act.trim()
            : undefined,
        say: item.say.trim(),
      });
    }
  }

  if (items.length === 0) {
    throw new Error("장면 내용을 만들어내지 못했어요.");
  }

  return items;
}

/**
 * 1:1 대화 한 턴({narration?, act?, say}) 응답을 파싱해서 지문+대사
 * SceneItem[]로 바꾼다. say는 스키마상 필수라 "지문만 있고 대사가
 * 없는" 응답 자체가 나올 수 없다 — say가 비어 있으면 그건 진짜 예외
 * 상황이니 에러로 알린다(호출부에서 재시도하면 된다).
 */
export function parseChatReply(raw: string, characterName: string): SceneItem[] {
  let text = raw.trim();

  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    text = fenceMatch[1].trim();
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("응답 형식을 이해하지 못했어요.");
  }
  text = text.slice(start, end + 1);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("응답 형식을 이해하지 못했어요.");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("응답 형식을 이해하지 못했어요.");
  }

  const obj = parsed as Record<string, unknown>;
  const say = typeof obj.say === "string" ? obj.say.trim() : "";
  if (!say) {
    throw new Error("캐릭터가 대답하지 않았어요. 다시 시도해 주세요.");
  }

  const items: SceneItem[] = [];
  const narration =
    typeof obj.narration === "string" ? obj.narration.trim() : "";
  if (narration) {
    items.push({ t: "n", text: narration });
  }
  const act = typeof obj.act === "string" && obj.act.trim() ? obj.act.trim() : undefined;
  items.push({ t: "d", who: characterName, act, say });

  return items;
}

/** "...", "‥" 처럼 내용 없는 말줄임표뿐인 대사는 실제로 대답한 게 아니라고 본다 */
export function hasContent(say: string): boolean {
  return say.replace(/[.\s…‥]/g, "").length > 0;
}

/** 이전 장면을 AI에게 다시 보여줄 때 쓰는 텍스트 표현 */
export function serializeItems(items: SceneItem[]): string {
  return items
    .map((item) =>
      item.t === "n"
        ? `(지문) ${item.text}`
        : `${item.who}${item.act ? ` (${item.act})` : ""}: ${item.say}`
    )
    .join("\n");
}
