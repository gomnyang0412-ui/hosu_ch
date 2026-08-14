"use client";

import { useEffect, useState } from "react";
import TopBar from "@/components/TopBar";
import { resizeImageFile } from "@/lib/image";
import { getAppSettings, saveAppSettings, StorageError } from "@/lib/storage";

// 전체 화면을 덮는 배경이라 아바타(320px)보다 훨씬 크게 남겨둔다 —
// 데스크톱 와이드 화면에서도 흐려 보이지 않도록.
const BACKGROUND_MAX_EDGE = 1600;

export default function SettingsPage() {
  const [backgroundImage, setBackgroundImage] = useState<string | undefined>(
    undefined
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getAppSettings()
      .then((s) => setBackgroundImage(s.backgroundImage))
      .catch(() => {
        // 못 불러와도 업로드 자체는 계속할 수 있으니 조용히 넘어간다
      });
  }, []);

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
      </main>
    </div>
  );
}
