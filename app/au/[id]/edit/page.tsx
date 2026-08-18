"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import UniverseForm from "@/components/UniverseForm";
import { getUniverse, storageErrorMessage } from "@/lib/storage";
import type { Universe } from "@/lib/types";

export default function EditUniversePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [universe, setUniverse] = useState<Universe | null | undefined>(
    undefined
  );
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const found = await getUniverse(id);
        if (!found) {
          router.replace("/au");
          return;
        }
        setUniverse(found);
      } catch (err) {
        // 못 찾은 것과 네트워크 문제를 구분한다 — 네트워크 문제로 못
        // 불러온 거라면 아무 설명 없이 목록으로 돌려보내지 않는다.
        setLoadError(storageErrorMessage(err, "세계관 정보를 불러오지 못했어요."));
      }
    })();
  }, [id, router]);

  if (loadError) {
    return <p className="p-4 text-sm text-red-600">{loadError}</p>;
  }
  if (!universe) return null;

  return <UniverseForm universe={universe} />;
}
