"use client";

import { useEffect, useState } from "react";
import TopBar from "@/components/TopBar";
import { resizeImageFile } from "@/lib/image";
import {
  getApiUsage,
  getAppSettings,
  saveAppSettings,
  StorageError,
} from "@/lib/storage";
import type { ApiUsageEntry } from "@/lib/types";

// 전체 화면을 덮는 배경이라 아바타(320px)보다 훨씬 크게 남겨둔다 —
// 데스크톱 와이드 화면에서도 흐려 보이지 않도록.
const BACKGROUND_MAX_EDGE = 1600;

export default function SettingsPage() {
  const [backgroundImage, setBackgroundImage] = useState<string | undefined>(
    undefined
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [usageDate, setUsageDate] = useState("");
  const [usageEntries, setUsageEntries] = useState<ApiUsageEntry[] | null>(null);
  const [usageError, setUsageError] = useState("");
  const [usageLoading, setUsageLoading] = useState(false);

  // 새로고침 버튼에서 쓰는, "누르는 순간" 로딩 상태부터 보여주는 버전.
  // 마운트 시 최초 로딩은 이걸 부르지 않고 useEffect 안에서 바로
  // then/catch로 처리한다 — 그래야 effect 본문에서 setState를 동기
  // 호출하지 않는다(react-hooks/set-state-in-effect).
  async function loadUsage() {
    setUsageLoading(true);
    setUsageError("");
    try {
      const { date, entries } = await getApiUsage();
      setUsageDate(date);
      setUsageEntries(entries);
    } catch (err) {
      setUsageError(
        err instanceof StorageError ? err.message : "사용량을 불러오지 못했어요."
      );
    } finally {
      setUsageLoading(false);
    }
  }

  useEffect(() => {
    getAppSettings()
      .then((s) => setBackgroundImage(s.backgroundImage))
      .catch(() => {
        // 못 불러와도 업로드 자체는 계속할 수 있으니 조용히 넘어간다
      });
    getApiUsage()
      .then(({ date, entries }) => {
        setUsageDate(date);
        setUsageEntries(entries);
      })
      .catch(() => setUsageError("사용량을 불러오지 못했어요."));
  }, []);

  const usageByKey = new Map<number, ApiUsageEntry[]>();
  for (const entry of usageEntries ?? []) {
    const list = usageByKey.get(entry.keyIndex) ?? [];
    list.push(entry);
    usageByKey.set(entry.keyIndex, list);
  }

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setLoading(true);
    setError("");
    try {
      const dataUrl = await resizeImageFile(file, BACKGROUND_MAX_EDGE, 0.75);
      await saveAppSettings({ backgroundImage: dataUrl, updatedAt: Date.now() });
      // AppBackground는 레이아웃 최상단에서 앱 전체 수명 동안 한 번만
      // 마운트되니, 지금 페이지만 새로고침해서는 그 컴포넌트가 새
      // 배경을 다시 불러오지 않는다. 전체 새로고침으로 바로 반영한다.
      window.location.reload();
    } catch (err) {
      setError(
        err instanceof StorageError || err instanceof Error
          ? err.message
          : "배경 이미지를 저장하지 못했어요."
      );
      setLoading(false);
    }
  }

  async function handleRemove() {
    setLoading(true);
    setError("");
    try {
      await saveAppSettings({ backgroundImage: undefined, updatedAt: Date.now() });
      window.location.reload();
    } catch (err) {
      setError(
        err instanceof StorageError
          ? err.message
          : "배경 이미지를 지우지 못했어요."
      );
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <TopBar title="설정" />

      <main className="flex flex-1 flex-col gap-4 px-4 py-4">
        <div className="glass card-shadow flex flex-col gap-3 rounded-2xl p-4">
          <div>
            <p className="text-sm font-semibold">앱 배경 이미지</p>
            <p className="mt-0.5 text-xs text-muted">
              앱 전체 뒤에 깔릴 배경이에요. 상단바·목록 카드처럼 여백 있는
              곳은 반투명해서 이 이미지가 은은하게 비쳐 보여요.
            </p>
          </div>

          {backgroundImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={backgroundImage}
              alt="현재 배경 이미지"
              className="max-h-64 w-full rounded-xl border border-border object-cover"
            />
          )}

          <div className="flex items-center gap-3">
            <label className="cursor-pointer rounded-full border border-border bg-card px-3 py-2 text-xs font-medium text-muted">
              {loading
                ? "처리 중…"
                : backgroundImage
                  ? "이미지 변경"
                  : "이미지 선택"}
              <input
                type="file"
                accept="image/*"
                onChange={handleChange}
                disabled={loading}
                className="hidden"
              />
            </label>
            {backgroundImage && (
              <button
                type="button"
                onClick={handleRemove}
                disabled={loading}
                className="text-xs text-red-600 disabled:opacity-40"
              >
                기본 배경으로 되돌리기
              </button>
            )}
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="glass card-shadow flex flex-col gap-3 rounded-2xl p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Gemini API 사용량</p>
              <p className="mt-0.5 text-xs text-muted">
                이 앱이 실제로 호출한 횟수예요. 구글의 하루 한도(RPD)는
                한국 시간이 아니라 태평양 자정에 초기화돼서(서머타임에 따라
                한국 시간 오후 4~5시경), 집계 기준일도 거기에 맞췄어요
                {usageDate && ` — 기준일 ${usageDate}(태평양)`}. 구글이 API
                키 기준으로는 남은 한도를 알려주지 않아서, 진짜 잔여량이
                아니라 앱이 직접 센 횟수예요.
              </p>
            </div>
            <button
              type="button"
              onClick={loadUsage}
              disabled={usageLoading}
              className="shrink-0 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted disabled:opacity-40"
            >
              {usageLoading ? "불러오는 중…" : "새로고침"}
            </button>
          </div>

          {usageError && <p className="text-xs text-red-600">{usageError}</p>}

          {usageEntries && usageEntries.length === 0 && (
            <p className="text-xs text-muted">
              이번 집계 기준일엔 아직 기록된 호출이 없어요.
            </p>
          )}

          {usageByKey.size > 0 && (
            <div className="flex flex-col gap-3">
              {Array.from(usageByKey.entries())
                .sort(([a], [b]) => a - b)
                .map(([keyIndex, entries]) => (
                  <div key={keyIndex} className="rounded-xl border border-border p-3">
                    <p className="mb-1.5 text-xs font-semibold">
                      키 {keyIndex}
                    </p>
                    <ul className="flex flex-col gap-1">
                      {entries.map((e) => (
                        <li
                          key={e.model}
                          className="flex items-center justify-between text-xs text-muted"
                        >
                          <span>{e.model}</span>
                          <span>
                            성공 {e.success}
                            {e.quota > 0 && (
                              <span className="text-red-600"> · 한도초과 {e.quota}</span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
