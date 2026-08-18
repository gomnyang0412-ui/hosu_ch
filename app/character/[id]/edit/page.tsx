"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import CharacterForm from "@/components/CharacterForm";
import { getCharacter, storageErrorMessage } from "@/lib/storage";
import type { Character } from "@/lib/types";

export default function EditCharacterPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [character, setCharacter] = useState<Character | null | undefined>(
    undefined
  );
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const found = await getCharacter(id);
        if (!found) {
          router.replace("/");
          return;
        }
        setCharacter(found);
      } catch (err) {
        // 못 찾은 것과 네트워크 문제를 구분한다 — 못 찾은 거면 목록으로
        // 돌려보내는 게 맞지만, 네트워크 문제로 못 불러온 거라면 아무
        // 설명 없이 목록으로 돌려보내면 왜 캐릭터가 사라졌는지 알 수
        // 없어 혼란스럽다.
        setLoadError(storageErrorMessage(err, "캐릭터 정보를 불러오지 못했어요."));
      }
    })();
  }, [id, router]);

  if (loadError) {
    return <p className="p-4 text-sm text-red-600">{loadError}</p>;
  }
  if (!character) return null;

  return <CharacterForm character={character} />;
}
