// 캐릭터별 누적 기억을 실제로 채우는 서버 전용 로직.
// (Redis + Gemini를 모두 부르므로 반드시 서버 라우트에서만 import한다)
import type { Content } from "@google/genai";
import { resolveVoiceCharacter } from "./character";
import { getChatHistory, getCharacterMemory, saveCharacterMemory } from "./db";
import { GeminiRequestError, generateSummaryText } from "./gemini";
import {
  MAX_PENDING_DAYS_PER_SYNC,
  MONTH_COMPACT_AFTER_WEEKS,
  WEEK_COMPACT_AFTER_DAYS,
  daysAgo,
  isoWeekEndDate,
  isoWeekLabel,
  kstDateString,
  monthLabel,
  todayKST,
} from "./memory";
import { serializeItems } from "./scene";
import type {
  Character,
  CharacterMemory,
  ChatMessage,
  MemoryEntry,
  Universe,
} from "./types";

// items가 있으면(사용자/AI 메시지 둘 다) 그 시점에 실제로 누가 한 말인지가
// 이미 기록돼 있어 그대로 쓴다 — 방 안에서 역할을 뒤바꾼 적이 있어도
// 정확하다. items가 없는 예전 메시지만 방 단위 기본값으로 추정한다.
function messageLine(m: ChatMessage, voiceCharacterName: string, userLabel: string): string {
  if (m.items && m.items.length > 0) return serializeItems(m.items);
  if (m.role === "model") {
    return serializeItems([{ t: "d" as const, who: voiceCharacterName, say: m.text }]);
  }
  return `${userLabel}: ${m.text}`;
}

async function summarizeForMemory(
  characterName: string,
  transcript: string,
  scope: MemoryEntry["scope"],
  label: string
): Promise<string> {
  if (!transcript.trim()) return "";
  const scopeDesc =
    scope === "day"
      ? `${label} 하루 동안`
      : scope === "week"
        ? `그 주(${label}) 동안의 기억 요약 여러 개를`
        : `그 달(${label}) 동안의 기억 요약 여러 개를`;
  const systemInstruction = [
    `[역할]`,
    `너는 "${characterName}"의 기억을 정리하는 사람이다. 아래는 ${scopeDesc} 실제 있었던 대화·사건 기록이다.`,
    `이걸 "${characterName}" 입장에서 나중까지 기억할 만한 사실 위주로 짧게 정리한다.`,
    ``,
    `[규칙]`,
    scope === "day"
      ? `1~3문장, 소설 지문체(3인칭, 과거형)로 요약한다.`
      : `2~4문장으로 더 압축해서 요약한다. 사소한 디테일은 버리고 중요한 사건·감정 변화 위주로 남긴다.`,
    `대사를 그대로 인용하지 않고, 있었던 일과 감정선만 남긴다.`,
    `설명이나 따옴표 없이 요약 문장만 출력한다.`,
  ].join("\n");
  const contents: Content[] = [{ role: "user", parts: [{ text: transcript }] }];
  const text = await generateSummaryText({ systemInstruction, contents });
  return text.trim();
}

/**
 * 아직 하나로 뭉치기엔 이른(최근 14일 이내) 하루 항목은 그대로 두고,
 * 그보다 오래돼 안정된 주는 주 단위로, 8주 넘게 지난 주는 달 단위로
 * 압축한다. 압축 하나가 실패해도 나머지는 계속 진행한다.
 */
async function compactMemoryEntries(
  memory: CharacterMemory,
  characterName: string
): Promise<void> {
  const today = todayKST();

  const dayEntries = memory.entries.filter((e) => e.scope === "day");
  const weekGroups = new Map<string, MemoryEntry[]>();
  for (const e of dayEntries) {
    const week = isoWeekLabel(e.label);
    if (daysAgo(isoWeekEndDate(week), today) < WEEK_COMPACT_AFTER_DAYS) continue;
    const arr = weekGroups.get(week) ?? [];
    arr.push(e);
    weekGroups.set(week, arr);
  }
  for (const [week, group] of weekGroups) {
    if (memory.entries.some((e) => e.scope === "week" && e.label === week)) continue;
    let summary: string;
    try {
      summary = await summarizeForMemory(
        characterName,
        group.map((e) => `${e.label}: ${e.summary}`).join("\n"),
        "week",
        week
      );
    } catch {
      continue;
    }
    if (!summary) continue;
    memory.entries = memory.entries.filter((e) => !group.includes(e));
    memory.entries.push({ scope: "week", label: week, summary, createdAt: Date.now() });
  }

  const weekEntries = memory.entries.filter((e) => e.scope === "week");
  const monthGroups = new Map<string, MemoryEntry[]>();
  for (const e of weekEntries) {
    const weeksPast = Math.floor(daysAgo(isoWeekEndDate(e.label), today) / 7);
    if (weeksPast < MONTH_COMPACT_AFTER_WEEKS) continue;
    const month = monthLabel(isoWeekEndDate(e.label));
    const arr = monthGroups.get(month) ?? [];
    arr.push(e);
    monthGroups.set(month, arr);
  }
  for (const [month, group] of monthGroups) {
    if (memory.entries.some((e) => e.scope === "month" && e.label === month)) continue;
    let summary: string;
    try {
      summary = await summarizeForMemory(
        characterName,
        group.map((e) => `${e.label}: ${e.summary}`).join("\n"),
        "month",
        month
      );
    } catch {
      continue;
    }
    if (!summary) continue;
    memory.entries = memory.entries.filter((e) => !group.includes(e));
    memory.entries.push({ scope: "month", label: month, summary, createdAt: Date.now() });
  }
}

/**
 * 캐릭터 한 명이 (역할 반전으로 다른 캐릭터 방에서 연기한 경우까지 포함해)
 * "본인"으로 실제 말한 모든 1:1 방의 대화를, 아직 정리 안 된 지난 날짜만
 * 골라 하루 단위로 요약해 기억에 쌓는다. 오늘 날짜는 아직 안 끝났으니
 * 제외한다.
 */
export async function syncCharacterMemory(
  character: Character,
  allCharacters: Character[],
  universes: Universe[]
): Promise<{ addedDays: number; more: boolean }> {
  const today = todayKST();
  const existing = await getCharacterMemory(character.id);
  const memory: CharacterMemory = existing ?? {
    characterId: character.id,
    summarizedThrough: "",
    entries: [],
    updatedAt: Date.now(),
  };

  const rooms = allCharacters
    .filter((c) => resolveVoiceCharacter(c, allCharacters).id === character.id)
    .flatMap((roomCharacter) =>
      universes.map((u) => ({ universeId: u.id, roomCharacter }))
    );
  if (rooms.length === 0) return { addedDays: 0, more: false };

  const byDate = new Map<string, string[]>();
  for (const { universeId, roomCharacter } of rooms) {
    const history = await getChatHistory(universeId, roomCharacter.id);
    if (history.length === 0) continue;
    const userLabel =
      roomCharacter.id === character.id ? "나(사용자)" : roomCharacter.name;
    for (const m of history) {
      const date = kstDateString(m.ts);
      if (date >= today || date <= memory.summarizedThrough) continue;
      const line = messageLine(m, character.name, userLabel).trim();
      if (!line) continue;
      const arr = byDate.get(date) ?? [];
      arr.push(line);
      byDate.set(date, arr);
    }
  }

  const pendingDates = Array.from(byDate.keys()).sort();
  if (pendingDates.length === 0) return { addedDays: 0, more: false };

  // 첫 백필처럼 밀린 날짜가 아주 많을 수 있으니, 한 번의 동기화에서는
  // 최대 이만큼만 처리하고 나머지는 다음 동기화(다음 접속) 때 이어간다.
  const toProcess = pendingDates.slice(0, MAX_PENDING_DAYS_PER_SYNC);
  let processed = 0;
  for (const date of toProcess) {
    const transcript = byDate.get(date)!.join("\n");
    let summary = "";
    try {
      summary = await summarizeForMemory(character.name, transcript, "day", date);
    } catch (err) {
      // 사용량 초과는 곧 풀릴 문제라 여기서 멈추고 다음 동기화 때 이
      // 날짜부터 다시 시도한다. 그 외(안전 정책 차단 등)는 재시도해도
      // 똑같이 실패할 가능성이 높아, 이 날짜의 기억만 비워두고 계속
      // 진행한다 — 한 날짜 때문에 그 뒤 날짜까지 영영 밀리면 안 된다.
      if (err instanceof GeminiRequestError && err.kind === "quota") break;
    }
    if (summary) {
      memory.entries.push({ scope: "day", label: date, summary, createdAt: Date.now() });
    }
    memory.summarizedThrough = date;
    processed++;
  }

  if (processed > 0) {
    try {
      await compactMemoryEntries(memory, character.name);
    } catch {
      // 압축 실패는 무시 — 다음 동기화 때 다시 시도된다
    }
    memory.updatedAt = Date.now();
    await saveCharacterMemory(memory);
  }

  return { addedDays: processed, more: processed < pendingDates.length };
}
