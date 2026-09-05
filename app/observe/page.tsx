"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import AutoGrowTextarea from "@/components/AutoGrowTextarea";
import BottomNav from "@/components/BottomNav";
import CharacterAvatar from "@/components/CharacterAvatar";
import EpisodeJumpPanel, { episodeAnchorId } from "@/components/EpisodeJumpPanel";
import {
  BackArrowIcon,
  BookIcon,
  BookmarkRibbonIcon,
  ChatBubbleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClapperIcon,
  CloseIcon,
  DownloadIcon,
  EditIcon,
  PlusIcon,
  StarIcon,
  TrashIcon,
} from "@/components/icons";
import { buildStoryEpub, buildStoryTxt, downloadBlob, exportStoryFilename } from "@/lib/exportStory";
import { resizeImageFile } from "@/lib/image";
import { sourceLabel } from "@/lib/modelLabel";
import {
  getCharacters,
  getChatHistory,
  getStories,
  getUniverse,
  getUniverses,
  saveStory,
  deleteStory,
  saveRoom,
  storageErrorMessage,
} from "@/lib/storage";
import { formatElapsedDays, nextArcRange, splitDirectiveInHalf } from "@/lib/story";
import { resolveUniverseTemplate } from "@/lib/template";
import {
  ORG_UNIVERSE_ID,
  createOrgUniverse,
  toCharacterProfile,
  type ArcSummary,
  type Character,
  type ObservationSession,
  type Room,
  type Universe,
} from "@/lib/types";

interface SceneErrorState {
  message: string;
  kind: "quota" | "network" | "overloaded" | "unknown" | "parse";
}

/** 목록 화면에서 다른 세계관(주로 AU) 이야기를 함께 보여줄 때, 어느
 *  세계관 소속인지 표시하려고 덧붙이는 태그 */
interface TaggedSession extends ObservationSession {
  universeTitle: string;
  isAu: boolean;
}

function storyTitle(session: ObservationSession, characters: Character[]): string {
  const names = session.characterIds
    .map((id) => characters.find((c) => c.id === id)?.name)
    .filter((n): n is string => !!n);
  const namePart = names.join(" X ") || "이야기";
  return session.topic.trim() ? `${namePart} · ${session.topic.trim()}` : namePart;
}

/** 책장 한 페이지에 보이는 책 수 (가로 3권 x 세로 3권) */
const BOOKS_PER_PAGE = 9;

/** ms만큼 기다린다. Gemini 연속 호출 사이 텀을 두거나, 실패 후 재시도 전 잠깐 쉴 때 쓴다.
 *  signal이 중간에 abort되면(사용자가 취소) 기다리다 말고 즉시 AbortError로 거절한다. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

// 화 하나를 만들다 일시적인 오류(타임아웃·서버 혼잡)가 나면 사용자에게
// 바로 실패를 보여주는 대신 짧게 쉬었다가 한 번 더 시도한다. quota(오늘
// 사용량 소진)는 재시도해도 똑같이 실패할 뿐이라 재시도 대상에서 뺐다.
const EPISODE_MAX_ATTEMPTS = 2;
const EPISODE_RETRY_DELAY_MS = 3000;

// "2화로 나눠 쓰기"는 같은 API 키에 화 두 개 분량의 요청을 몇 초 간격으로
// 연달아 보낸다. 분당 요청 한도(RPM)에 몰리면 두 번째 화가 더 자주
// 실패하는 경향이 있어서, 화 사이에 짧은 텀을 둬 그 부담을 완화한다.
// 1화 생성 자체가 quota 초과로 여러 모델×키를 빠르게 훑으면(각각
// lib/gemini.ts의 retryDelayMs로 400ms씩 쉬긴 하지만) 그것만으로도 이번
// 분의 RPM을 상당히 써버릴 수 있어서, 4초로는 부족한 경우가 있었다
// (2026-09-01 진단). 8초로 늘려 다음 분으로 넘어갈 여유를 더 준다.
const TWO_PART_GAP_MS = 8000;

// "쓰는 중…" 진행 바가 서서히 차오르는 속도의 기준값. 정확한 %가 아니라
// 추정치라(위 requestEpisode 주석 참고) 화 하나가 보통 이 정도 걸린다는
// 대략적인 감각만 반영한다 — 실제로 이보다 빨리 끝나도 늦게 끝나도 상관
// 없이, 92%에서 멈춰 기다리다가 응답이 오면 화면 자체가 사라진다.
const ESTIMATED_EPISODE_MS = 20_000;

export default function ObservePage() {
  return (
    <Suspense fallback={null}>
      <ObservePageInner />
    </Suspense>
  );
}

function ObservePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const universeId = searchParams.get("universe") || ORG_UNIVERSE_ID;
  const storyId = searchParams.get("story");
  /** UniverseForm의 "이 AU로 관찰 모드 시작하기" 버튼처럼, 목록이 아니라
   *  바로 새 이야기 폼부터 보여줘야 하는 진입점 표시. 목록 화면은
   *  browseSessions(다른 유니버스 포함)가 비어 있을 때만 폼을 자동으로
   *  띄우는데, 다른 유니버스에 이야기가 하나라도 있으면 정작 이 AU가
   *  비어 있어도 폼 대신 목록이 뜨는 문제가 있어 이 파라미터로 우회한다. */
  const forceNewForm = searchParams.get("new") === "1";

  const [universe, setUniverse] = useState<Universe | null>(null);
  const [allCharacters, setAllCharacters] = useState<Character[]>([]);
  const [stories, setStories] = useState<ObservationSession[] | null>(null);
  /** 지금 보고 있는 유니버스가 아닌 다른 유니버스(주로 AU)들의 이야기.
   *  "관찰" 탭 하나에서 AU 이야기까지 같이 훑어볼 수 있도록 목록 화면에
   *  섞어서 보여준다. 지금 유니버스의 stories는 이미 생성/이어쓰기/삭제
   *  때마다 바로바로 갱신되니, 이쪽은 유니버스를 옮겨갈 때만 다시 불러도
   *  충분하다(다른 탭에서 동시에 편집 중이 아닌 한 어긋날 일이 없다). */
  const [otherStories, setOtherStories] = useState<TaggedSession[]>([]);
  const [showNewForm, setShowNewForm] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [hasHistoryIds, setHasHistoryIds] = useState<Set<string>>(new Set());
  const [importIds, setImportIds] = useState<string[]>([]);
  const [topic, setTopic] = useState("");
  const [coverImage, setCoverImage] = useState<string | undefined>(undefined);
  const [coverImageLoading, setCoverImageLoading] = useState(false);
  const [shelfPage, setShelfPage] = useState(0);
  const [directive, setDirective] = useState("");
  const [twoPartMode, setTwoPartMode] = useState(false);
  const [timeSkipAmount, setTimeSkipAmount] = useState("");
  const [timeSkipUnit, setTimeSkipUnit] = useState<"day" | "month" | "year">("month");
  const [generatingPart, setGeneratingPart] = useState<1 | 2 | null>(null);
  const [loading, setLoading] = useState(false);
  const [genProgress, setGenProgress] = useState(0);
  const [error, setError] = useState<SceneErrorState | null>(null);
  // 화 생성 중(재시도 대기, 2화 사이 텀 포함)에 사용자가 취소할 수 있게
  // 하는 컨트롤러. handleStart·handleContinue가 시작할 때 새로 만들어
  // 채워 넣고, requestEpisode와 화 사이 대기(sleep)가 이걸 공유해서 쓴다.
  const abortRef = useRef<AbortController | null>(null);
  // handleStart·handleContinue 중복 실행 방지. loading state만으로는
  // 막을 수 없다 — 오류가 나서 "다시 시도" 버튼을 빠르게 여러 번 누르면
  // React가 loading=true로 리렌더링하기 전에 클릭 이벤트가 먼저 여러 번
  // 들어와서, 같은 화(같은 인덱스)를 만드는 요청이 동시에 여러 개
  // 나가버린다 — 그러면 서로 다른 초안이 각자 완성되는 순서대로 저장을
  // 덮어써서, 방금 본 화 본문이 조금 뒤 다른 내용으로 바뀌어 보이는
  // 버그였다(2026-09-02 사용자 리포트). ref는 리렌더링을 안 기다리고
  // 즉시 갱신되니 이 경우엔 state보다 ref로 막아야 한다.
  const isGeneratingRef = useRef(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [startingChat, setStartingChat] = useState(false);
  const [startChatError, setStartChatError] = useState("");
  const [showEpisodeJump, setShowEpisodeJump] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportingEpub, setExportingEpub] = useState(false);
  const [showAddCharacter, setShowAddCharacter] = useState(false);
  const [showCurrentState, setShowCurrentState] = useState(false);
  const [addingCharacterId, setAddingCharacterId] = useState<string | null>(null);
  // 수정 중인 화의 번호(session.episodes의 index 필드). null이면 편집 중 아님.
  const [editingEpisodeIndex, setEditingEpisodeIndex] = useState<number | null>(null);
  const [episodeEditText, setEpisodeEditText] = useState("");
  // "다음 이야기로 넘어가기"로 만든 산문 요약. 새 이야기 폼의
  // characterContext로 이어받아서 매 화 프롬프트에 계속 같이 보낸다.
  // null이면 이어받은 요약 없음(평범한 새 이야기 시작).
  const [carryOverSummary, setCarryOverSummary] = useState<string | null>(null);
  const [summarizingStory, setSummarizingStory] = useState(false);
  const [summarizeError, setSummarizeError] = useState("");

  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    setStories(null);
    setOtherStories([]);
    setShowNewForm(forceNewForm);
    setSelectedIds([]);
    setImportIds([]);
    setTopic("");
    setCoverImage(undefined);
    setShelfPage(0);
    setDirective("");
    setTwoPartMode(false);
    setTimeSkipAmount("");
    setError(null);
    setCarryOverSummary(null);
    setSummarizeError("");
    (async () => {
      try {
        const [characters, storyList, foundUniverse, universes] = await Promise.all([
          getCharacters(),
          getStories(universeId),
          getUniverse(universeId).catch(() => undefined),
          getUniverses().catch(() => []),
        ]);
        setAllCharacters(characters);
        setStories(storyList);
        const resolvedFoundUniverse = foundUniverse ?? createOrgUniverse();
        setUniverse(resolvedFoundUniverse);

        const others = universes.filter((u) => u.id !== universeId);
        const otherLists = await Promise.all(
          others.map(async (u) => {
            const list = await getStories(u.id).catch(() => []);
            return list.map((s) => ({
              ...s,
              universeTitle: u.title,
              isAu: u.type === "au",
            }));
          })
        );
        setOtherStories(otherLists.flat());
        if (
          resolvedFoundUniverse.type === "au" &&
          resolvedFoundUniverse.roleA &&
          resolvedFoundUniverse.roleB
        ) {
          setSelectedIds([
            resolvedFoundUniverse.roleA,
            resolvedFoundUniverse.roleB,
          ]);
        }
        const withHistory = await Promise.all(
          characters.map(async (c) => {
            const history = await getChatHistory(universeId, c.id).catch(
              () => []
            );
            return history.length > 0 ? c.id : null;
          })
        );
        setHasHistoryIds(
          new Set(withHistory.filter((id): id is string => !!id))
        );
      } catch {
        setLoadError("불러오지 못했어요. 새로고침해 주세요.");
        setStories([]);
      }
    })();
  }, [universeId]);

  // 다른 이야기로 넘어갔는데 편집 중이던 텍스트가 남아있으면, 그 새
  // 이야기의 최근 화 위에 엉뚱한(이전 이야기의) 내용으로 저장 버튼이
  // 떠 있는 위험한 상태가 된다 — 화 편집은 실제로 덮어쓰는 동작이라
  // 조용히 넘어가면 안 된다.
  useEffect(() => {
    setEditingEpisodeIndex(null);
    setEpisodeEditText("");
  }, [storyId]);

  /**
   * 목록의 이야기 하나를 갱신해서 화면에 반영하고, 그대로 서버에도
   * 저장한다. 여러 핸들러(화 이어쓰기·인물 추가·화 삭제·북마크·구간
   * 요약 압축)가 "목록 상태 갱신 → 저장 → 실패 시 에러 표시"를 각자
   * 그대로 반복하고 있던 걸 하나로 모은 것. onSaveError를 안 넘기면
   * 저장 실패는 조용히 무시한다(구간 요약 압축처럼 "실패해도 다음에
   * 다시 시도되면 그만"인 경우용). afterUpdate는 상태 갱신 직후,
   * 저장을 기다리기 전에 동기적으로 실행된다(입력창 비우기처럼 저장
   * 완료를 기다릴 필요 없는 부수 효과용).
   */
  async function persistStoryUpdate(
    updated: ObservationSession,
    options?: { onSaveError?: string; afterUpdate?: () => void }
  ) {
    setStories((prev) =>
      (prev ?? []).map((s) => (s.id === updated.id ? updated : s))
    );
    options?.afterUpdate?.();
    try {
      await saveStory(updated);
    } catch (err) {
      if (options?.onSaveError) {
        setError({
          message: storageErrorMessage(err, options.onSaveError),
          kind: "unknown",
        });
      }
    }
  }

  const session = stories?.find((s) => s.id === storyId) ?? null;

  const sceneCharacters = session
    ? session.characterIds
        .map((id) => allCharacters.find((c) => c.id === id))
        .filter((c): c is Character => !!c)
    : [];

  function toggleSelect(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  }

  function toggleImport(id: string) {
    setImportIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]
    );
  }

  /** 캐릭터 한 명의 1:1 대화를 요약해 "- 이름:\n요약" 한 덩어리로 만든다. 나눌
   *  대화가 없거나 요약에 실패하면 null. */
  async function summarizeCharacterHistory(
    c: Character,
    resolvedUniverse: Universe
  ): Promise<string | null> {
    const history = await getChatHistory(universeId, c.id).catch(() => []);
    if (history.length === 0) return null;
    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          character: toCharacterProfile(c),
          characterId: c.id,
          universe: resolvedUniverse,
          history,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.summary === "string" && data.summary.trim()) {
        return `- ${c.name}:\n${data.summary.trim()}`;
      }
      return null;
    } catch {
      return null;
    }
  }

  /** 체크한 캐릭터들의 1:1 대화를 요약해 하나의 맥락 블록으로 합친다 */
  async function buildCharacterContext(
    characters: Character[],
    resolvedUniverse: Universe
  ): Promise<string> {
    const parts: string[] = [];
    for (const c of characters) {
      if (!importIds.includes(c.id)) continue;
      const part = await summarizeCharacterHistory(c, resolvedUniverse);
      if (part) parts.push(part);
    }
    return parts.join("\n\n");
  }

  /** 지금 이야기를 처음부터 끝까지 산문체로 요약해서, 등장인물·표지 없이
   *  새 이야기 폼으로 넘어간다. 요약은 carryOverSummary에 담겨 새 이야기의
   *  characterContext로 이어받아진다(handleStart 참고) — 화가 너무 많이
   *  쌓여 매 화 프롬프트가 무거워지기 전에, 같은 인물들로 새 이야기를
   *  시작하되 지금까지의 서사는 잃지 않게 하기 위한 기능. */
  async function handleCarryOverToNewStory() {
    if (!session || !universe) return;
    setSummarizingStory(true);
    setSummarizeError("");
    try {
      const characters = allCharacters.filter((c) =>
        session.characterIds.includes(c.id)
      );
      const res = await fetch("/api/summarize-observation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characters: characters.map(toCharacterProfile),
          universe: resolveUniverseTemplate(universe, allCharacters),
          storyId: session.id,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.summary !== "string" || !data.summary.trim()) {
        throw new Error(data.error || "이야기를 요약하지 못했어요.");
      }
      setCarryOverSummary(data.summary.trim());
      setSelectedIds(session.characterIds);
      setImportIds([]);
      setTopic("");
      setCoverImage(undefined);
      setShowNewForm(true);
      router.push(`/observe?universe=${universeId}`);
    } catch (err) {
      setSummarizeError(
        err instanceof Error ? err.message : "이야기를 요약하지 못했어요."
      );
    } finally {
      setSummarizingStory(false);
    }
  }

  async function requestEpisode(params: {
    characters: Character[];
    /** 있으면 이 이야기에 이어쓰기, 없으면 topic·characterIds로 새 이야기 시작 */
    storyId?: string;
    topic?: string;
    characterIds?: string[];
    characterContext?: string;
    coverImage?: string;
    directive?: string;
    addElapsedDays?: number;
    twoPart?: "first" | "second";
  }): Promise<{ story: ObservationSession } | null> {
    if (!universe) return null;
    setLoading(true);
    setError(null);
    setGenProgress(0);
    // 진짜 진행률이 아니라 "그럴듯한" 추정치다 — Gemini 호출이 완전히
    // 끝나야 응답이 오는 방식(스트리밍 아님)이라 서버도 지금 몇 %인지
    // 전혀 모른다. 그래서 보통 걸리는 시간을 기준으로 서서히 차오르다가
    // 92%에서 멈춰 기다리고, 실제로 응답이 오면 그 즉시 로딩 화면
    // 자체가 사라진다(2026-09-02).
    const genStartedAt = Date.now();
    const progressTimer = setInterval(() => {
      const elapsed = Date.now() - genStartedAt;
      setGenProgress(
        Math.min(92, Math.round((1 - Math.exp(-elapsed / (ESTIMATED_EPISODE_MS / 2.5))) * 92))
      );
    }, 200);
    try {
      const resolvedUniverse = resolveUniverseTemplate(universe, allCharacters);
      const signal = abortRef.current?.signal;
      for (let attempt = 1; attempt <= EPISODE_MAX_ATTEMPTS; attempt++) {
        let failure: SceneErrorState;
        try {
          const res = await fetch("/api/scene", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              characters: params.characters.map(toCharacterProfile),
              universe: resolvedUniverse,
              storyId: params.storyId,
              topic: params.topic,
              characterIds: params.characterIds,
              characterContext: params.characterContext,
              coverImage: params.coverImage,
              directive: params.directive,
              addElapsedDays: params.addElapsedDays,
              twoPart: params.twoPart,
            }),
            signal,
          });
          const data = await res.json();
          if (res.ok) {
            setLoading(false);
            return { story: data.story as ObservationSession };
          }
          failure = {
            message: data.error ?? "이번 화를 만들지 못했어요.",
            kind: data.kind ?? "unknown",
          };
        } catch (err) {
          // 사용자가 취소 버튼을 눌러 abort된 경우 — 실패가 아니라 의도한
          // 중단이니 에러 메시지 없이 조용히 빠져나간다.
          if (err instanceof DOMException && err.name === "AbortError") {
            setLoading(false);
            return null;
          }
          failure = {
            message: "네트워크 문제로 이번 화를 만들지 못했어요.",
            kind: "network",
          };
        }
        // 타임아웃·서버 혼잡(overloaded)처럼 잠깐 후 다시 시도하면 풀릴 수
        // 있는 오류만 재시도한다. quota는 오늘 한도가 다 찬 것이라 바로
        // 또 불러도 똑같이 실패할 뿐이고, unknown(안전 정책 차단 등)도
        // 재시도로 나아질 가능성이 낮다.
        const canRetry =
          attempt < EPISODE_MAX_ATTEMPTS &&
          (failure.kind === "network" || failure.kind === "overloaded");
        if (!canRetry) {
          setError(failure);
          setLoading(false);
          return null;
        }
        try {
          await sleep(EPISODE_RETRY_DELAY_MS, signal);
        } catch {
          setLoading(false);
          return null;
        }
      }
      setLoading(false);
      return null;
    } finally {
      clearInterval(progressTimer);
    }
  }

  /** 화 생성(재시도 대기·2화 사이 텀 포함)을 취소한다. */
  function cancelGeneration() {
    abortRef.current?.abort();
  }

  async function handleCoverImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setCoverImageLoading(true);
    try {
      setCoverImage(await resizeImageFile(file, 640));
    } catch {
      setError({ message: "표지 이미지를 불러오지 못했어요.", kind: "unknown" });
    } finally {
      setCoverImageLoading(false);
    }
  }

  /** 이미 진행 중인 이야기에서 표지를 나중에 새로 넣거나 바꿀 때 쓴다.
   *  새 이야기 시작 폼의 coverImage(초안 상태)와 달리, 여기서는 선택하는
   *  즉시 그 이야기에 바로 저장한다. */
  async function handleSessionCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !session) return;
    setCoverImageLoading(true);
    try {
      const dataUrl = await resizeImageFile(file, 640);
      await persistStoryUpdate(
        { ...session, coverImage: dataUrl, updatedAt: Date.now() },
        { onSaveError: "표지 이미지를 저장하지 못했어요." }
      );
    } catch {
      setError({ message: "표지 이미지를 불러오지 못했어요.", kind: "unknown" });
    } finally {
      setCoverImageLoading(false);
    }
  }

  async function handleRemoveSessionCover() {
    if (!session) return;
    setCoverImageLoading(true);
    try {
      await persistStoryUpdate(
        { ...session, coverImage: undefined, updatedAt: Date.now() },
        { onSaveError: "표지 이미지를 지우지 못했어요." }
      );
    } finally {
      setCoverImageLoading(false);
    }
  }

  async function handleStart() {
    if (selectedIds.length < 2 || !topic.trim() || !universe) return;
    if (isGeneratingRef.current) return;
    isGeneratingRef.current = true;
    try {
      const characters = allCharacters.filter((c) => selectedIds.includes(c.id));
      setLoading(true);
      const importedContext =
        importIds.length > 0
          ? await buildCharacterContext(
              characters,
              resolveUniverseTemplate(universe, allCharacters)
            )
          : "";
      // 이전 이야기에서 이어받은 산문 요약(있으면)이 1:1 대화 가져오기
      // 요약보다 앞에 오도록 합친다 — 둘 다 characterContext 한 필드로
      // 들어가 매 화 프롬프트에 계속 같이 보내진다.
      const characterContext = [carryOverSummary, importedContext]
        .filter((s) => s?.trim())
        .join("\n\n");
      setLoading(false);
      abortRef.current = new AbortController();
      // 화를 만드는 것과 동시에 서버가 바로 Redis에 저장까지 마친다 —
      // 이 응답을 못 받아도(화면을 꺼뒀거나 탭을 닫아도) 이야기 자체는
      // 안전하게 저장돼 있다. 여기선 그 결과를 받아 화면에 바로
      // 반영하고 새 이야기로 이동하기만 하면 된다.
      const result = await requestEpisode({
        characters,
        topic: topic.trim(),
        characterIds: selectedIds,
        characterContext,
        coverImage,
      });
      abortRef.current = null;
      if (!result) return;
      setCarryOverSummary(null);
      setStories((prev) => [...(prev ?? []), result.story]);
      router.push(`/observe?universe=${universeId}&story=${result.story.id}`);
    } finally {
      isGeneratingRef.current = false;
    }
  }

  /**
   * 전문/한 줄 요약 범위(RECENT_FULL_COUNT+RECAP_LIMIT화) 밖으로 밀려난
   * 화가 ARC_CHUNK_SIZE만큼 쌓였으면, 그 구간을 압축해 arcSummaries에
   * 追加한다. 실패해도 다음 화 쓰기 자체는 막지 않는다(다음 이어쓰기
   * 때 다시 시도됨).
   */
  async function compactArcIfNeeded(
    target: ObservationSession,
    resolvedUniverse: Universe
  ): Promise<ObservationSession> {
    const range = nextArcRange(target.episodes.length, target.arcSummaries);
    if (!range) return target;
    const chunk = target.episodes.filter(
      (e) => e.index >= range.fromIndex && e.index <= range.toIndex
    );
    if (chunk.length === 0) return target;
    try {
      const res = await fetch("/api/summarize-arc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characters: sceneCharacters.map(toCharacterProfile),
          universe: resolvedUniverse,
          episodes: chunk,
          previousSummaries: target.arcSummaries,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.summary !== "string" || !data.summary.trim()) {
        return target;
      }
      const arc: ArcSummary = {
        fromIndex: range.fromIndex,
        toIndex: range.toIndex,
        summary: data.summary.trim(),
        createdAt: Date.now(),
      };
      return {
        ...target,
        arcSummaries: [...(target.arcSummaries ?? []), arc],
      };
    } catch {
      return target;
    }
  }

  /**
   * "2화로 나눠 쓰기" 체크 시 자동으로 덧붙는 지시. 사용자가 직접 "2편"
   * 같은 키워드를 입력하게 하는 대신, 체크박스로 명시적으로 켠 경우에만
   * 코드에서 붙인다 — 지문에 우연히 비슷한 단어가 들어가도 오작동하지
   * 않는다.
   *
   * 지시문 원문은 splitDirectiveInHalf로 미리 반씩 잘라서 각 화 요청엔
   * 그 절반만 보낸다(1화 요청엔 뒷부분 내용 자체가 아예 안 보임) — 이
   * 안내문은 그 절반이 전체 사건 중 어느 쪽인지만 알려준다.
   */
  const TWO_PART_NOTES: Record<1 | 2, string> = {
    1: "위 지시문은 이번 화와 다음 화, 두 화에 걸쳐 진행될 사건 중 앞부분 내용만 담고 있다(뒷부분은 다음 화 몫이라 여기 안 보인다). 이 내용만 서두르지 말고 밀도 있게 그리고, 사건을 끝까지 다루려 하지 않는다.",
    2: "위 지시문은 직전 화(1화)에서 이미 진행된 사건에 곧바로 이어지는 뒷부분 내용이다. 1화에서 벌어진 상황·대사·행동을 다시 서술하거나 되풀이하지 말고, 그 장면이 멈춘 바로 다음 순간부터 위 내용을 자연스럽게 이어서 쓴다.",
  };

  async function handleContinue() {
    if (!session || !universe) return;
    if (isGeneratingRef.current) return;
    isGeneratingRef.current = true;
    try {
      const resolvedUniverse = resolveUniverseTemplate(universe, allCharacters);
      const compacted = await compactArcIfNeeded(session, resolvedUniverse);
      // 구간 요약 저장에 실패해도(onSaveError 생략 = 조용히 무시) 화 쓰기는
      // 계속 진행한다 — 다음 이어쓰기 때 다시 시도된다
      if (compacted !== session) await persistStoryUpdate(compacted);

      const userDirective = directive.trim();
      const parts: (1 | 2)[] = twoPartMode ? [1, 2] : [1];
      // 지시문을 미리 반으로 잘라 각 화 요청엔 그 절반만 보낸다 —
      // "이번 화엔 앞부분만 다뤄라" 같은 프롬프트 지시만으로는 지시문이
      // 길고 구체적일수록 AI가 결국 1화 안에 전부 욱여넣는 경향이
      // 강했다(2026-09-03 사용자 리포트, splitDirectiveInHalf 주석 참고).
      const [directiveFirstHalf, directiveSecondHalf] = twoPartMode
        ? splitDirectiveInHalf(userDirective)
        : [userDirective, userDirective];

      // "+ 시간 경과" 입력을 일 단위로 환산한 값. 서버가 저장된 이야기의
      // elapsedDays에 직접 더해서 저장하므로(2026-09-02), 여기선 텍스트로
      // 보여줄 skipNote만 만들고 1화 요청에만 addElapsedDays로 실어 보낸다.
      const skipAmount = Number(timeSkipAmount);
      const skipDays =
        Number.isFinite(skipAmount) && skipAmount > 0
          ? Math.round(
              skipAmount * (timeSkipUnit === "year" ? 365 : timeSkipUnit === "month" ? 30 : 1)
            )
          : 0;
      const skipNote =
        skipDays > 0
          ? `[시간 경과] 이번 화는 직전 화로부터 약 ${formatElapsedDays(skipDays)} 지난 시점부터 시작한다.`
          : "";

      const controller = new AbortController();
      abortRef.current = controller;

      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (i > 0) {
          // 같은 API 키에 화 두 개 분량 요청이 바로 붙어서 나가면 분당
          // 요청 한도에 몰릴 수 있어, 다음 화를 시작하기 전에 짧게 쉰다.
          setLoading(true);
          try {
            await sleep(TWO_PART_GAP_MS, controller.signal);
          } catch {
            setGeneratingPart(null);
            setLoading(false);
            abortRef.current = null;
            return;
          }
        }
        setGeneratingPart(twoPartMode ? part : null);
        const combinedDirective = twoPartMode
          ? [
              part === 1 ? directiveFirstHalf : directiveSecondHalf,
              part === 1 ? skipNote : "",
              TWO_PART_NOTES[part],
            ]
              .filter(Boolean)
              .join(" ")
          : [userDirective, skipNote].filter(Boolean).join(" ");
        const result = await requestEpisode({
          characters: sceneCharacters,
          storyId: compacted.id,
          directive: combinedDirective || undefined,
          addElapsedDays: part === 1 && skipDays > 0 ? skipDays : undefined,
          twoPart: twoPartMode ? (part === 1 ? "first" : "second") : undefined,
        });
        if (!result) {
          setGeneratingPart(null);
          abortRef.current = null;
          return;
        }
        // 서버가 화 생성과 동시에 저장까지 이미 끝냈다 — 여기선 방금
        // 받은 최신 이야기를 화면에 반영하기만 하면 된다(네트워크
        // 저장 호출을 또 할 필요 없음).
        setStories((prev) =>
          (prev ?? []).map((s) => (s.id === result.story.id ? result.story : s))
        );
        const isLastPart = part === parts[parts.length - 1];
        if (isLastPart) {
          setDirective("");
          setTimeSkipAmount("");
        }
      }
      setGeneratingPart(null);
      abortRef.current = null;
    } finally {
      isGeneratingRef.current = false;
    }
  }

  function handleExportTxt() {
    if (!session) return;
    const text = buildStoryTxt(session, allCharacters);
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, exportStoryFilename(session, allCharacters, "txt"));
    setShowExportMenu(false);
  }

  async function handleExportEpub() {
    if (!session) return;
    setExportingEpub(true);
    try {
      const blob = await buildStoryEpub(session, allCharacters);
      downloadBlob(blob, exportStoryFilename(session, allCharacters, "epub"));
      setShowExportMenu(false);
    } catch {
      setError({
        message: "epub 파일을 만들지 못했어요. 다시 시도해 주세요.",
        kind: "unknown",
      });
    } finally {
      setExportingEpub(false);
    }
  }

  async function handleDeleteStory(id: string, targetUniverseId = universeId) {
    if (!window.confirm("이 이야기를 삭제할까요? 되돌릴 수 없어요.")) return;
    setDeletingId(id);
    try {
      await deleteStory(targetUniverseId, id);
      if (targetUniverseId === universeId) {
        setStories((prev) => (prev ?? []).filter((s) => s.id !== id));
      } else {
        setOtherStories((prev) => prev.filter((s) => s.id !== id));
      }
      if (storyId === id) {
        router.push(`/observe?universe=${universeId}`);
      }
    } catch (err) {
      setError({
        message: storageErrorMessage(err, "이야기를 지우지 못했어요."),
        kind: "unknown",
      });
    } finally {
      setDeletingId(null);
    }
  }

  /**
   * 지금까지 읽은 화들을 10줄 안팎으로 요약해 지문으로 미리 넣어둔
   * 새 멀티 대화방을 만든다. 기존 1:1 채팅방과 헷갈리지 않게 제목을
   * "상황 대화방"으로 고정한다.
   */
  async function handleStartSituationChat() {
    if (!session || !universe) return;
    setStartingChat(true);
    setStartChatError("");
    try {
      const res = await fetch("/api/summarize-story", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          characters: sceneCharacters.map(toCharacterProfile),
          universe: resolveUniverseTemplate(universe, allCharacters),
          episodes: session.episodes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data.summary !== "string" || !data.summary.trim()) {
        setStartChatError(data.error ?? "상황을 요약하지 못했어요.");
        return;
      }

      const names = sceneCharacters.map((c) => c.name).join(" X ");
      const now = Date.now();
      const thread: Room = {
        id: crypto.randomUUID(),
        universeId,
        kind: "group",
        characterIds: session.characterIds,
        title: `상황 대화방 · ${names}`,
        items: [{ t: "n", text: data.summary.trim(), ts: now }],
        createdAt: now,
        updatedAt: now,
      };
      await saveRoom(thread);
      router.push(`/thread/${thread.id}?universe=${universeId}`);
    } catch (err) {
      setStartChatError(
        storageErrorMessage(err, "네트워크 문제로 대화방을 만들지 못했어요.")
      );
    } finally {
      setStartingChat(false);
    }
  }

  /**
   * 진행 중인 이야기에 등장하지 않던 인물을 중간에 새로 끌어들인다.
   * 등장인물 목록에 더하면 그때부터 설정(성격·말투 등)은 다음 화부터
   * 자동으로 반영되고, 그 인물과 나눈 1:1 대화가 있으면 요약해서
   * characterContext에 이어붙인다.
   */
  async function handleAddCharacter(c: Character) {
    if (!session || !universe || session.characterIds.includes(c.id)) return;
    setAddingCharacterId(c.id);
    try {
      const part = await summarizeCharacterHistory(
        c,
        resolveUniverseTemplate(universe, allCharacters)
      );
      const updated: ObservationSession = {
        ...session,
        characterIds: [...session.characterIds, c.id],
        characterContext: [session.characterContext, part]
          .filter(Boolean)
          .join("\n\n"),
      };
      await persistStoryUpdate(updated, {
        onSaveError: "인물을 추가하지 못했어요.",
        afterUpdate: () => setShowAddCharacter(false),
      });
    } finally {
      setAddingCharacterId(null);
    }
  }

  // 최근 몇 화 안에 문제 있는 내용(예: 콘텐츠 정책에 걸려 이후 이어쓰기가
  // 계속 막히는 경우)이 있을 때 되짚어 지울 수 있도록 최근 10화까지 허용한다.
  // 그보다 오래된 화는 이미 [지난 구간 요약]으로 압축돼 원문 자체가 프롬프트에
  // 안 실리므로 여기서 손댈 이유가 적다.
  const EDITABLE_EPISODE_WINDOW = 10;

  function isEpisodeEditable(index: number): boolean {
    if (!session) return false;
    return index > session.episodes.length - EDITABLE_EPISODE_WINDOW;
  }

  async function deleteEpisode(index: number) {
    if (!session) return;
    const target = session.episodes.find((ep) => ep.index === index);
    if (!target) return;
    const isLatest = index === session.episodes.length;
    if (
      !window.confirm(
        isLatest
          ? "이 화를 지울까요? 되돌릴 수 없어요."
          : "이 화를 지울까요? 되돌릴 수 없고, 뒤에 이어지는 화 번호가 하나씩 당겨져요."
      )
    )
      return;
    const updated: ObservationSession = {
      ...session,
      episodes: session.episodes
        .filter((ep) => ep.index !== index)
        .map((ep) => (ep.index > index ? { ...ep, index: ep.index - 1 } : ep)),
      updatedAt: Date.now(),
    };
    await persistStoryUpdate(updated, { onSaveError: "화를 지우지 못했어요." });
  }

  // 전체적으로 마음에 드는 화인데 한 군데만 어색해서 통째로 지우고
  // 다시 생성하기는 아까울 때, 최근 화의 본문을 직접 고쳐 쓸 수 있게
  // 한다. 이미 그 화 이후 화들의 프롬프트에 [최근 N화 전문]/[지금까지의
  // 줄거리]로 반영된 적이 있어서, 지금 고쳐도 그 반영분까지 소급되진
  // 않는다 — 그래서 최근 10화(EDITABLE_EPISODE_WINDOW)로만 제한한다
  // (다음 이어쓰기부터는 고친 내용이 그대로 반영된다).
  function startEditEpisode(index: number) {
    if (!session) return;
    const target = session.episodes.find((ep) => ep.index === index);
    if (!target) return;
    setEpisodeEditText(target.text);
    setEditingEpisodeIndex(index);
  }

  function cancelEditEpisode() {
    setEditingEpisodeIndex(null);
    setEpisodeEditText("");
  }

  async function submitEditEpisode() {
    const text = episodeEditText.trim();
    if (!text || !session || editingEpisodeIndex === null) return;
    const updated: ObservationSession = {
      ...session,
      episodes: session.episodes.map((ep) =>
        ep.index === editingEpisodeIndex ? { ...ep, text } : ep
      ),
      updatedAt: Date.now(),
    };
    setEditingEpisodeIndex(null);
    setEpisodeEditText("");
    await persistStoryUpdate(updated, { onSaveError: "화 내용을 저장하지 못했어요." });
  }

  async function toggleBookmark(index: number) {
    if (!session) return;
    const updated: ObservationSession = {
      ...session,
      episodes: session.episodes.map((ep) =>
        ep.index === index ? { ...ep, bookmarked: !ep.bookmarked } : ep
      ),
    };
    await persistStoryUpdate(updated, { onSaveError: "북마크를 저장하지 못했어요." });
  }

  function jumpToEpisode(index: number) {
    setShowEpisodeJump(false);
    // 패널 닫힘 리렌더와 겹치지 않게 한 틱 뒤에 스크롤한다.
    setTimeout(() => {
      document
        .getElementById(episodeAnchorId(index))
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  if (stories === null) return null;

  const isAu = universe && universe.type === "au";
  const browseSessions: TaggedSession[] = [
    ...stories.map((s) => ({
      ...s,
      universeTitle: universe?.title ?? "",
      isAu: !!isAu,
    })),
    ...otherStories,
  ].sort((a, b) => b.updatedAt - a.updatedAt);
  const showForm = showNewForm || browseSessions.length === 0;
  const shelfTotalPages = Math.max(1, Math.ceil(browseSessions.length / BOOKS_PER_PAGE));
  const shelfPageClamped = Math.min(shelfPage, shelfTotalPages - 1);
  const shelfBooks = browseSessions.slice(
    shelfPageClamped * BOOKS_PER_PAGE,
    shelfPageClamped * BOOKS_PER_PAGE + BOOKS_PER_PAGE
  );

  return (
    <div className="flex flex-1 flex-col">
      <header className="glass card-shadow sticky top-0 z-10 flex items-center justify-between px-4 py-3">
        <h1 className="text-xl font-bold">
          관찰 모드{isAu && <span className="text-muted"> · {universe.title}</span>}
        </h1>
        {session ? (
          <div className="flex items-center gap-1">
            <Link
              href={`/observe?universe=${universeId}`}
              onClick={() => setShowEpisodeJump(false)}
              className="flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted transition-transform hover:scale-[1.03] active:scale-[0.97]"
            >
              <BackArrowIcon /> 목록
            </Link>
            {session.episodes.length > 1 && (
              <button
                type="button"
                onClick={() => setShowEpisodeJump(true)}
                aria-label="화별로 이동"
                title="화별로 이동"
                className="rounded-full border border-border bg-card px-3 py-1.5 text-sm text-muted transition-transform hover:scale-[1.03] active:scale-[0.97]"
              >
                <BookmarkRibbonIcon />
              </button>
            )}
            {session.episodes.length > 0 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowExportMenu((v) => !v)}
                  aria-label="내보내기"
                  title="내보내기"
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-sm text-muted transition-transform hover:scale-[1.03] active:scale-[0.97]"
                >
                  <DownloadIcon />
                </button>
                {showExportMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowExportMenu(false)}
                    />
                    <div className="glass card-shadow absolute top-full right-0 z-20 mt-1 flex w-36 flex-col overflow-hidden rounded-xl">
                      <button
                        type="button"
                        onClick={handleExportTxt}
                        className="px-3 py-2 text-left text-sm hover:bg-background"
                      >
                        TXT로 내보내기
                      </button>
                      <button
                        type="button"
                        onClick={handleExportEpub}
                        disabled={exportingEpub}
                        className="px-3 py-2 text-left text-sm hover:bg-background disabled:opacity-40"
                      >
                        {exportingEpub ? "만드는 중…" : "EPUB로 내보내기"}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => handleDeleteStory(session.id)}
              disabled={deletingId === session.id}
              className="flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-red-600 transition-transform hover:scale-[1.03] active:scale-[0.97] disabled:opacity-40"
            >
              <TrashIcon /> 삭제
            </button>
          </div>
        ) : (
          !showForm &&
          browseSessions.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setCarryOverSummary(null);
                setShowNewForm(true);
              }}
              className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-transform hover:scale-[1.03] active:scale-[0.97]"
            >
              + 새 이야기
            </button>
          )
        )}
      </header>

      <EpisodeJumpPanel
        open={showEpisodeJump}
        episodes={session?.episodes ?? []}
        onJump={jumpToEpisode}
        onClose={() => setShowEpisodeJump(false)}
      />

      <main className="mx-auto flex w-full max-w-[680px] flex-1 flex-col px-4 pb-4">
        {loadError && <p className="mb-3 text-sm text-red-600">{loadError}</p>}
        {!session ? (
          <div className="flex flex-1 flex-col gap-5">
            {allCharacters.length < 2 ? (
              <p className="mt-8 text-center text-sm text-muted">
                관찰 모드를 쓰려면 캐릭터가 2명 이상 필요해요.
                <br />
                캐릭터 탭에서 먼저 캐릭터를 추가해 주세요.
              </p>
            ) : showForm ? (
              <>
                <div className="relative aspect-[2/3] w-full overflow-hidden rounded-2xl border border-dashed border-border bg-card">
                  <label className="flex h-full w-full cursor-pointer items-center justify-center">
                    {coverImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={coverImage} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="flex flex-col items-center gap-1.5 text-muted">
                        {coverImageLoading ? (
                          <span className="text-xs">불러오는 중…</span>
                        ) : (
                          <>
                            <PlusIcon className="text-3xl" />
                            <span className="text-xs">책 표지 넣기 (선택)</span>
                          </>
                        )}
                      </span>
                    )}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleCoverImageChange}
                      disabled={coverImageLoading}
                      className="hidden"
                    />
                  </label>
                  {coverImage && (
                    <button
                      type="button"
                      onClick={() => setCoverImage(undefined)}
                      aria-label="표지 이미지 삭제"
                      className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white transition-transform hover:scale-110"
                    >
                      <CloseIcon />
                    </button>
                  )}
                </div>

                <div>
                  <p className="mb-2 text-sm font-medium">
                    등장할 캐릭터 (2명 이상)
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {allCharacters.map((c) => {
                      const active = selectedIds.includes(c.id);
                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => toggleSelect(c.id)}
                          className="flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-sm transition-colors"
                          style={
                            active
                              ? {
                                  borderColor: c.accentColor,
                                  backgroundColor: `${c.accentColor}1A`,
                                  color: c.accentColor,
                                }
                              : { borderColor: "var(--border)" }
                          }
                        >
                          <CharacterAvatar character={c} size="sm" />
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {carryOverSummary !== null && (
                  <div className="flex flex-col gap-2 rounded-2xl border border-primary/30 bg-primary/5 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium">
                        이전 이야기 요약을 이어받았어요
                      </p>
                      <button
                        type="button"
                        onClick={() => setCarryOverSummary(null)}
                        className="shrink-0 text-xs text-muted underline"
                      >
                        지우기
                      </button>
                    </div>
                    <p className="text-xs text-muted">
                      이 요약이 새 이야기 내내 배경으로 계속 참고돼요. 필요하면
                      직접 다듬어도 돼요.
                    </p>
                    <textarea
                      value={carryOverSummary}
                      onChange={(e) => setCarryOverSummary(e.target.value)}
                      rows={8}
                      className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-primary/50"
                    />
                  </div>
                )}

                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">주제</span>
                  <textarea
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="예: 고등학교 생활 / 비 오는 날 하교길에 마주쳤다"
                    rows={3}
                    className="rounded-xl border border-border bg-card p-3 text-sm leading-relaxed outline-none focus:border-primary/50"
                  />
                </label>
                <p className="-mt-3 text-xs text-muted">
                  한 화당 2800~3000자 안팎의 단편소설로 이어져요.
                </p>

                {selectedIds.some((id) => hasHistoryIds.has(id)) && (
                  <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3">
                    <p className="text-sm font-medium">이전 1:1 대화 가져오기</p>
                    <p className="text-xs text-muted">
                      체크하면 그 캐릭터와 나눈 1:1 대화를 요약해서 이야기
                      내내 캐릭터가 실제 말투·성격에서 벗어나지 않게 참고해요.
                    </p>
                    <div className="flex flex-col gap-1.5">
                      {allCharacters
                        .filter(
                          (c) => selectedIds.includes(c.id) && hasHistoryIds.has(c.id)
                        )
                        .map((c) => (
                          <label key={c.id} className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={importIds.includes(c.id)}
                              onChange={() => toggleImport(c.id)}
                              className="h-4 w-4"
                            />
                            {c.name}와의 1:1 대화 가져오기
                          </label>
                        ))}
                    </div>
                  </div>
                )}

                {error && (
                  <div className="flex flex-col items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    <span>{error.message}</span>
                    <button
                      type="button"
                      onClick={handleStart}
                      className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium"
                    >
                      다시 시도
                    </button>
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleStart}
                    disabled={selectedIds.length < 2 || !topic.trim() || loading}
                    className="group flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3 pr-3 pl-5 text-sm font-semibold text-primary-foreground transition-transform hover:scale-[1.01] active:scale-[0.98] disabled:opacity-40 disabled:hover:scale-100"
                  >
                    {loading
                      ? importIds.length > 0
                        ? "이전 대화 요약하는 중…"
                        : `1화를 쓰는 중… ${genProgress}%`
                      : (
                        <>
                          이야기 시작
                          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary-foreground/20 transition-transform group-hover:translate-x-0.5">
                            <ChevronRightIcon />
                          </span>
                        </>
                      )}
                  </button>
                  {loading && (
                    <button
                      type="button"
                      onClick={cancelGeneration}
                      className="rounded-full border border-border px-3 py-3 text-xs text-muted transition-transform hover:scale-[1.03] active:scale-[0.97]"
                    >
                      취소
                    </button>
                  )}
                </div>
                {loading && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-200"
                      style={{ width: `${genProgress}%` }}
                    />
                  </div>
                )}

                {browseSessions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowNewForm(false)}
                    className="flex items-center gap-1 self-start text-xs text-muted underline"
                  >
                    <BackArrowIcon /> 목록으로
                  </button>
                )}
              </>
            ) : (
              <div className="flex flex-1 flex-col gap-3">
                <div className="flex-1 rounded-2xl border border-border bg-card p-3">
                  <div className="grid h-full grid-cols-3 grid-rows-3 gap-3">
                    {shelfBooks.map((s) => (
                      <div
                        key={s.id}
                        className="group relative overflow-hidden rounded-lg shadow-md ring-1 ring-black/10 transition-transform hover:-translate-y-1"
                      >
                        <Link
                          href={`/observe?universe=${s.universeId}&story=${s.id}`}
                          className="absolute inset-0"
                        >
                          {s.coverImage ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={s.coverImage}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div
                              className={`flex h-full w-full flex-col items-center justify-center gap-1.5 p-2 text-center ${
                                s.isAu ? "bg-accent/15" : "bg-primary/15"
                              }`}
                            >
                              <BookIcon className="text-2xl text-muted" />
                              <span className="line-clamp-3 text-[10px] font-medium text-foreground">
                                {storyTitle(s, allCharacters)}
                              </span>
                            </div>
                          )}
                          {s.coverImage && (
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-1.5 pt-5 pb-1.5">
                              <p className="truncate text-[10px] font-semibold text-white">
                                {storyTitle(s, allCharacters)}
                              </p>
                            </div>
                          )}
                          {s.isAu && (
                            <span className="absolute top-1 left-1 rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold text-accent-foreground">
                              AU
                            </span>
                          )}
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleDeleteStory(s.id, s.universeId)}
                          disabled={deletingId === s.id}
                          aria-label="이야기 삭제"
                          className="absolute top-1 right-1 z-10 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white transition-transform hover:scale-110 disabled:opacity-40"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    ))}
                    {Array.from({ length: BOOKS_PER_PAGE - shelfBooks.length }).map((_, i) => (
                      <div key={`empty-${i}`} />
                    ))}
                  </div>
                </div>

                {shelfTotalPages > 1 && (
                  <div className="flex items-center justify-center gap-4">
                    <button
                      type="button"
                      onClick={() => setShelfPage((p) => Math.max(0, p - 1))}
                      disabled={shelfPageClamped === 0}
                      aria-label="이전 페이지"
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-border transition-transform hover:scale-110 disabled:opacity-30"
                    >
                      <ChevronLeftIcon />
                    </button>
                    <span className="text-xs text-muted">
                      {shelfPageClamped + 1} / {shelfTotalPages}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setShelfPage((p) => Math.min(shelfTotalPages - 1, p + 1))
                      }
                      disabled={shelfPageClamped === shelfTotalPages - 1}
                      aria-label="다음 페이지"
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-border transition-transform hover:scale-110 disabled:opacity-30"
                    >
                      <ChevronRightIcon />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              {session.coverImage ? (
                <div className="relative aspect-[2/3] w-full overflow-hidden rounded-2xl">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={session.coverImage}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute top-2 right-2 flex gap-1.5">
                    <label className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-black/50 text-white transition-transform hover:scale-110">
                      <EditIcon />
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleSessionCoverChange}
                        disabled={coverImageLoading}
                        className="hidden"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleRemoveSessionCover}
                      disabled={coverImageLoading}
                      aria-label="표지 이미지 삭제"
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white transition-transform hover:scale-110 disabled:opacity-40"
                    >
                      <CloseIcon />
                    </button>
                  </div>
                </div>
              ) : (
                <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 self-start rounded-full border border-dashed border-border px-2.5 py-1 text-xs text-muted">
                  {coverImageLoading ? (
                    "불러오는 중…"
                  ) : (
                    <>
                      <PlusIcon /> 표지 추가
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleSessionCoverChange}
                    disabled={coverImageLoading}
                    className="hidden"
                  />
                </label>
              )}
              <p className="text-xs text-muted">
                주제: {session.topic}
                {session.elapsedDays && session.elapsedDays > 0 ? (
                  <> · 이야기 속 경과 {formatElapsedDays(session.elapsedDays)}</>
                ) : null}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {sceneCharacters.map((c) => (
                  <span
                    key={c.id}
                    className="flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs"
                    style={{ borderColor: c.accentColor, color: c.accentColor }}
                  >
                    <CharacterAvatar character={c} size="sm" />
                    {c.name}
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => setShowAddCharacter((v) => !v)}
                  className="rounded-full border border-dashed border-border px-2 py-1 text-xs text-muted"
                >
                  + 인물 추가
                </button>
              </div>

              {session.currentState?.trim() && (
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => setShowCurrentState((v) => !v)}
                    className="flex w-fit items-center gap-1 text-xs text-muted"
                  >
                    <ChevronRightIcon
                      className={showCurrentState ? "rotate-90" : ""}
                    />
                    지금 이야기 상태
                  </button>
                  {showCurrentState && (
                    <pre className="whitespace-pre-wrap rounded-2xl border border-border bg-card p-3 text-xs text-muted">
                      {session.currentState.trim()}
                    </pre>
                  )}
                </div>
              )}

              {showAddCharacter && (
                <div className="flex flex-col gap-1.5 rounded-2xl border border-border bg-card p-3">
                  <p className="text-xs text-muted">
                    등장인물로 더하면 설정은 다음 화부터 바로 반영되고, 1:1
                    대화가 있으면 요약해서 함께 참고해요.
                  </p>
                  {allCharacters.filter((c) => !session.characterIds.includes(c.id))
                    .length === 0 ? (
                    <p className="text-xs text-muted">더할 수 있는 인물이 없어요.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {allCharacters
                        .filter((c) => !session.characterIds.includes(c.id))
                        .map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => handleAddCharacter(c)}
                            disabled={addingCharacterId !== null}
                            className="flex items-center gap-1.5 rounded-full border border-border px-2 py-1 text-xs disabled:opacity-40"
                          >
                            <CharacterAvatar character={c} size="sm" />
                            {addingCharacterId === c.id ? "추가하는 중…" : c.name}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={handleStartSituationChat}
                disabled={startingChat}
                className="flex items-center gap-1.5 self-start rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium transition-transform hover:scale-[1.03] active:scale-[0.97] disabled:opacity-40"
              >
                {startingChat ? (
                  "상황 요약하는 중…"
                ) : (
                  <>
                    <ChatBubbleIcon /> 이 상황으로 대화 시작
                  </>
                )}
              </button>
              {startChatError && (
                <p className="text-xs text-red-600">{startChatError}</p>
              )}
            </div>

            <div className="flex flex-col gap-8">
              {session.episodes.map((ep, i) => (
                <article
                  key={ep.index}
                  id={episodeAnchorId(ep.index)}
                  className={`flex scroll-mt-20 flex-col gap-3 ${
                    i > 0 ? "border-t border-dashed border-border pt-6" : ""
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-muted">
                      {ep.index}화
                    </h2>
                    {!(editingEpisodeIndex === ep.index) && (
                      <div className="flex items-center gap-3">
                        {isEpisodeEditable(ep.index) && (
                          <>
                            <button
                              type="button"
                              onClick={() => startEditEpisode(ep.index)}
                              aria-label="이 화 수정"
                              title="최근 10화까지 수정할 수 있어요"
                              className="text-sm leading-none text-muted opacity-60 transition-transform hover:scale-110 hover:text-foreground hover:opacity-100"
                            >
                              <EditIcon />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteEpisode(ep.index)}
                              aria-label="이 화 삭제"
                              title="최근 10화까지 지울 수 있어요"
                              className="text-sm leading-none text-muted opacity-60 transition-transform hover:scale-110 hover:text-red-600 hover:opacity-100"
                            >
                              <TrashIcon />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => toggleBookmark(ep.index)}
                          aria-label={ep.bookmarked ? "북마크 해제" : "북마크 하기"}
                          title={ep.bookmarked ? "북마크 해제" : "북마크 하기"}
                          className={`text-base leading-none transition-transform hover:scale-110 ${
                            ep.bookmarked ? "text-accent" : "text-muted opacity-40 hover:opacity-70"
                          }`}
                        >
                          <StarIcon filled={ep.bookmarked} />
                        </button>
                      </div>
                    )}
                  </div>
                  {ep.directive && (
                    <p className="flex items-center gap-1 text-xs italic text-muted">
                      <ClapperIcon /> 지시: {ep.directive}
                    </p>
                  )}
                  {editingEpisodeIndex === ep.index ? (
                    <div className="flex flex-col gap-2">
                      <AutoGrowTextarea
                        value={episodeEditText}
                        onChange={setEpisodeEditText}
                        maxHeightPx={600}
                        className="resize-none rounded-xl border border-border bg-card p-3 text-[15px] leading-[1.9] tracking-[0.01em] text-foreground outline-none focus:border-primary/50"
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={cancelEditEpisode}
                          className="rounded-full border border-border px-3 py-1.5 text-xs text-muted transition-transform hover:scale-[1.03] active:scale-[0.97]"
                        >
                          취소
                        </button>
                        <button
                          type="button"
                          onClick={submitEditEpisode}
                          disabled={!episodeEditText.trim()}
                          className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-transform hover:scale-[1.03] active:scale-[0.97] disabled:opacity-40 disabled:hover:scale-100"
                        >
                          저장
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-4">
                      {ep.text
                        .split(/\n+/)
                        .map((p) => p.trim())
                        .filter(Boolean)
                        .map((paragraph, i) => (
                          <p
                            key={i}
                            className="text-[15px] leading-[1.9] tracking-[0.01em] text-foreground"
                          >
                            {paragraph}
                          </p>
                        ))}
                    </div>
                  )}
                  {sourceLabel(ep.model, ep.keyIndex) && (
                    <span className="text-[10px] text-muted/70">
                      {sourceLabel(ep.model, ep.keyIndex)}
                    </span>
                  )}
                </article>
              ))}
            </div>

            {loading && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-center gap-3">
                  <p className="text-sm text-muted">
                    {generatingPart ? `${generatingPart}/2화 쓰는 중… ${genProgress}%` : `다음 화를 쓰는 중… ${genProgress}%`}
                  </p>
                  <button
                    type="button"
                    onClick={cancelGeneration}
                    className="rounded-full border border-border px-3 py-1 text-xs text-muted transition-transform hover:scale-[1.03] active:scale-[0.97]"
                  >
                    취소
                  </button>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-200"
                    style={{ width: `${genProgress}%` }}
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="flex flex-col items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                <span>{error.message}</span>
                <button
                  type="button"
                  onClick={handleContinue}
                  className="rounded-full border border-red-300 px-3 py-1 text-xs font-medium"
                >
                  다시 시도
                </button>
              </div>
            )}

            {!loading && (
              <div className="flex flex-col gap-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted">
                    다음 화 지시 (선택)
                  </span>
                  <AutoGrowTextarea
                    value={directive}
                    onChange={setDirective}
                    placeholder="예: 민준은 서연과 함께 도서관으로 이동한다"
                    maxHeightPx={200}
                    className="resize-none rounded-xl border border-border bg-card p-2.5 text-sm outline-none focus:border-primary/50"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={twoPartMode}
                    onChange={(e) => setTwoPartMode(e.target.checked)}
                    className="h-4 w-4"
                  />
                  이 사건, 2화로 나눠 쓰기
                </label>
                <div className="flex items-center gap-1.5 text-xs text-muted">
                  <span>시간 경과 (선택, 직전 화로부터)</span>
                  <input
                    type="number"
                    min={0}
                    value={timeSkipAmount}
                    onChange={(e) => setTimeSkipAmount(e.target.value)}
                    placeholder="0"
                    className="w-16 rounded-lg border border-border bg-card px-2 py-1 text-sm outline-none focus:border-primary/50"
                  />
                  <select
                    value={timeSkipUnit}
                    onChange={(e) =>
                      setTimeSkipUnit(e.target.value as "day" | "month" | "year")
                    }
                    className="rounded-lg border border-border bg-card px-2 py-1 text-sm outline-none focus:border-primary/50"
                  >
                    <option value="day">일</option>
                    <option value="month">개월</option>
                    <option value="year">년</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleContinue}
                  className="group flex items-center justify-center gap-2 rounded-xl bg-accent py-3 pr-3 pl-5 text-sm font-semibold text-accent-foreground transition-transform hover:scale-[1.01] active:scale-[0.98]"
                >
                  {twoPartMode
                    ? `${session.episodes.length + 1}~${session.episodes.length + 2}화 이어쓰기`
                    : `${session.episodes.length + 1}화 이어쓰기`}
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-foreground/20 transition-transform group-hover:translate-x-0.5">
                    <ChevronRightIcon />
                  </span>
                </button>

                <div className="mt-2 flex flex-col gap-1.5 border-t border-border pt-3">
                  <p className="text-xs text-muted">
                    화가 많이 쌓여 무거워졌다면, 지금까지의 이야기를 산문으로
                    요약해서 같은 인물들로 새 이야기를 시작할 수 있어요.
                  </p>
                  {summarizeError && (
                    <p className="text-xs text-red-600">{summarizeError}</p>
                  )}
                  <button
                    type="button"
                    onClick={handleCarryOverToNewStory}
                    disabled={summarizingStory}
                    className="self-start rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted transition-transform hover:scale-[1.03] active:scale-[0.97] disabled:opacity-40"
                  >
                    {summarizingStory
                      ? "이야기 요약하는 중…"
                      : "다음 이야기로 넘어가기"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      <BottomNav />
    </div>
  );
}
