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
  memoryOneLiners,
  monthLabel,
  todayKST,
} from "./memory";
import { serializeItems } from "./scene";
import type {
  Character,
  CharacterMemory,
  ChatMessage,
  MemoryEntry,
  ObservationSession,
  Room,
  RoomItem,
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

/** 그룹 대화방 아이템 하나를 기억용 한 줄로 바꾼다. 사용자 발화(t:"u")는
 *  그 방에서 "나는 이 중 한 명이다"로 고른 캐릭터가 있으면 그 이름으로,
 *  없으면 "나(사용자)"로 표시한다. */
function groupItemLine(item: RoomItem, room: Room, allCharacters: Character[]): string {
  switch (item.t) {
    case "n":
      return `(지문) ${item.text}`;
    case "x":
      return `(상황 전환) ${item.text}`;
    case "d":
      return `${item.who}${item.act ? ` (${item.act})` : ""}: ${item.say}`;
    case "u": {
      const playerName = room.playerCharacterId
        ? allCharacters.find((c) => c.id === room.playerCharacterId)?.name
        : undefined;
      return `${playerName ?? "나(사용자)"}: ${item.text}`;
    }
  }
}

// 하루 요약이 기존 기억과 겹치기만 할 뿐 새로 남길 게 없을 때 모델이
// 대신 출력하는 표시. 실제로 텍스트를 비워서 보내면 generate()가 "AI가
// 빈 응답을 보냈어요" 오류로 처리해버려서, 빈 문자열 대신 이 리터럴을 쓴다.
const NOTHING_NEW_MARKER = "NONE";

/**
 * existingMemory를 주면(비어있지 않으면) 그 내용과 겹치는 걸 다시 적지
 * 않도록 프롬프트에 같이 보여준다 — 매일 비슷한 잡담을 나눠도 "오늘도
 * 소소한 이야기를 나눴다"류의 거의 같은 문장이 날마다 독립적으로 쌓이는
 * 중복 문제의 핵심 원인이 "그날 대화만 보고 기존 기억은 전혀 모른 채
 * 요약한다"는 점이었다. day 스코프에서만 "새로 남길 게 전혀 없으면
 * NONE만 출력"을 허용한다 — week/month 압축은 엔트리 개수 자체를 줄이는
 * 게 목적이라 항상 결과를 만들어야 하고, 대신 중복 "문구"만 줄이는 데
 * existingMemory를 쓴다.
 */
async function summarizeForMemory(
  characterName: string,
  transcript: string,
  scope: MemoryEntry["scope"],
  label: string,
  existingMemory?: string
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
    existingMemory?.trim()
      ? [
          ``,
          `[이미 기록된 기억]`,
          existingMemory.trim(),
          ``,
          `위 기억에 이미 나온 성격·관계·반복되는 패턴은 다시 적지 않는다 — 이번 기록에서 그 기억에 없던 새로운 사실·사건·감정 변화만 남긴다.`,
          scope === "day"
            ? `이번 기록이 이미 아는 내용을 재확인하는 수준일 뿐 새로 남길 게 전혀 없다면, 다른 말 없이 정확히 "${NOTHING_NEW_MARKER}"라고만 출력한다.`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    ``,
    `[규칙]`,
    scope === "day"
      ? `1~3문장, 소설 지문체(3인칭, 과거형)로 요약한다.`
      : `2~4문장으로 더 압축해서 요약한다. 사소한 디테일은 버리고 중요한 사건·감정 변화 위주로 남긴다.`,
    `대사를 그대로 인용하지 않고, 있었던 일과 감정선만 남긴다.`,
    `설명이나 따옴표 없이 요약 문장만 출력한다.`,
  ]
    .filter(Boolean)
    .join("\n");
  const contents: Content[] = [{ role: "user", parts: [{ text: transcript }] }];
  const text = (await generateSummaryText({ systemInstruction, contents })).trim();
  if (scope === "day" && text === NOTHING_NEW_MARKER) return "";
  return text;
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
    const existingMemory = memoryOneLiners({
      ...memory,
      entries: memory.entries.filter((e) => !group.includes(e)),
    }).join("\n");
    let summary: string;
    try {
      summary = await summarizeForMemory(
        characterName,
        group.map((e) => `${e.label}: ${e.summary}`).join("\n"),
        "week",
        week,
        existingMemory
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
    const existingMemory = memoryOneLiners({
      ...memory,
      entries: memory.entries.filter((e) => !group.includes(e)),
    }).join("\n");
    let summary: string;
    try {
      summary = await summarizeForMemory(
        characterName,
        group.map((e) => `${e.label}: ${e.summary}`).join("\n"),
        "month",
        month,
        existingMemory
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
 * 캐릭터 한 명이 한 유니버스 안에서 (역할 반전으로 다른 캐릭터 방에서
 * 연기한 경우까지 포함해) "본인"으로 실제 말한 1:1 방 + 참가한 그룹
 * 대화방의 대화 + 등장한 관찰 모드 이야기의 화들을, 아직 정리 안 된
 * 지난 날짜만 골라 하루 단위로 요약해 그 유니버스 전용 기억에 쌓는다.
 * 오늘 날짜는 아직 안 끝났으니 제외한다.
 *
 * 기억은 유니버스별로 완전히 분리된다 — 다른 유니버스(특히 ORG)의
 * 서사가 AU 롤플레이로 새어 들어가지 않게 하기 위해서다. 그래서 이
 * 함수는 유니버스 하나당 한 번씩 호출해야 한다(호출부가 캐릭터 ×
 * 유니버스 조합을 돌면서 부른다).
 *
 * rooms/stories는 호출부가 이 유니버스의 방·이야기 목록을 한 번만
 * 불러와 넘겨준다.
 */
export async function syncCharacterMemory(
  character: Character,
  universeId: string,
  allCharacters: Character[],
  rooms: Room[],
  stories: ObservationSession[]
): Promise<{ addedDays: number; more: boolean }> {
  const today = todayKST();
  const existing = await getCharacterMemory(character.id, universeId);
  const memory: CharacterMemory = existing ?? {
    characterId: character.id,
    universeId,
    summarizedThrough: "",
    entries: [],
    updatedAt: Date.now(),
  };

  const singleRoomCharacters = allCharacters.filter(
    (c) => resolveVoiceCharacter(c, allCharacters).id === character.id
  );

  const groupRooms = rooms.filter(
    (r) => r.kind === "group" && r.characterIds.includes(character.id)
  );

  const relevantStories = stories.filter((s) => s.characterIds.includes(character.id));

  if (
    singleRoomCharacters.length === 0 &&
    groupRooms.length === 0 &&
    relevantStories.length === 0
  ) {
    return { addedDays: 0, more: false };
  }

  const byDate = new Map<string, string[]>();
  for (const roomCharacter of singleRoomCharacters) {
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
  for (const room of groupRooms) {
    for (const item of room.items) {
      const date = kstDateString(item.ts);
      if (date >= today || date <= memory.summarizedThrough) continue;
      const line = groupItemLine(item, room, allCharacters).trim();
      if (!line) continue;
      const arr = byDate.get(date) ?? [];
      arr.push(line);
      byDate.set(date, arr);
    }
  }
  // 화 자체엔 날짜가 없던 시절(createdAt 필드 생기기 전)에 쓰인 화는
  // 어느 날짜로 묶어야 할지 알 수 없어 건너뛴다 — 억지로 세션의
  // updatedAt 하나에 몰아넣으면 몇 주치 화가 하루로 뭉개져 요약이
  // 부정확해진다. 그런 화들은 그냥 기억 동기화 대상에서 빠질 뿐,
  // 이야기 자체나 관찰 모드 표시에는 전혀 영향이 없다.
  for (const story of relevantStories) {
    for (const episode of story.episodes) {
      if (!episode.createdAt) continue;
      const date = kstDateString(episode.createdAt);
      if (date >= today || date <= memory.summarizedThrough) continue;
      const line = `(관찰모드 ${episode.index}화 - ${story.topic}) ${episode.text}`.trim();
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
    const existingMemory = memoryOneLiners(memory).join("\n");
    let summary = "";
    try {
      summary = await summarizeForMemory(character.name, transcript, "day", date, existingMemory);
    } catch (err) {
      // 사용량 초과·네트워크 문제·서버 과부하는 곧 풀릴 일시적 문제라
      // 여기서 멈추고 다음 동기화 때 이 날짜부터 다시 시도한다(진행
      // 마커를 전진시키지 않는다). 그 외(안전 정책 차단 등 진짜로
      // 재시도해도 똑같이 실패할 종류)만 이 날짜의 기억을 비워두고
      // 계속 진행한다 — 한 날짜 때문에 그 뒤 날짜까지 영영 밀리면
      // 안 되지만, 일시적 오류로 그 날짜의 기억이 영영 사라져서도
      // 안 된다.
      if (
        err instanceof GeminiRequestError &&
        (err.kind === "quota" || err.kind === "network" || err.kind === "overloaded")
      ) {
        break;
      }
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
