"use client";

import { useEffect, useState } from "react";
import { getAppSettings } from "@/lib/storage";

/**
 * 사용자가 올린 배경 이미지를 전체 화면 뒤에 고정으로 깐다. 상단바·
 * 사이드바·목록 카드 같은 반투명 유리 표면(.glass)이 이 위에 얹혀서
 * 은은하게 비쳐 보인다. 이미지를 아직 안 골랐으면 아무것도 그리지
 * 않고, body의 기본 아이보리 배경(var(--background))이 그대로 보인다.
 */
export default function AppBackground() {
  const [image, setImage] = useState<string | undefined>(undefined);

  useEffect(() => {
    getAppSettings()
      .then((s) => setImage(s.backgroundImage))
      .catch(() => {
        // 못 불러와도 기본 아이보리 배경으로 조용히 넘어간다
      });
  }, []);

  if (!image) return null;

  return (
    <div
      aria-hidden
      className="fixed inset-0 -z-10 bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: `url(${image})` }}
    />
  );
}
