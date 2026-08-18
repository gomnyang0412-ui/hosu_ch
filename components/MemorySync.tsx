"use client";

import { useEffect } from "react";

const STORAGE_KEY = "hiatus:lastMemorySync";
// 밀린 날짜가 많은 첫 실행 등을 대비해, 서버가 "더 처리할 게 남았다"고
// 하면 같은 접속 안에서 몇 번 더 이어서 호출한다 (무한 재시도는 아님).
// 너무 크게 잡으면 캐릭터 × 유니버스 조합이 많을 때 한 번의 접속에서
// Gemini 호출이 오래 몰려, 그 사이 사용자가 직접 쓰는 화면(관찰모드 등)의
// Gemini 호출과 API 키를 두고 경쟁해 느려질 수 있다 — 다 못 끝낸 나머지는
// 어차피 다음 접속(하루 뒤)에 이어서 처리되니 작게 잡아도 괜찮다.
const MAX_ROUNDS = 2;

function todayKST(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Seoul" });
}

/**
 * 날짜가 하루 지날 때마다(=마지막으로 동기화한 날짜와 오늘이 다르면)
 * 백그라운드로 캐릭터별 기억 정리를 한 번 돌린다. 화면에는 아무것도
 * 그리지 않는다.
 */
export default function MemorySync() {
  useEffect(() => {
    const today = todayKST();
    if (window.localStorage.getItem(STORAGE_KEY) === today) return;

    let cancelled = false;
    (async () => {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        let more = false;
        try {
          const res = await fetch("/api/memory/sync", { method: "POST" });
          if (!res.ok) return;
          const data = await res.json();
          more = !!data.more;
        } catch {
          return;
        }
        if (cancelled) return;
        if (!more) break;
      }
      window.localStorage.setItem(STORAGE_KEY, today);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
