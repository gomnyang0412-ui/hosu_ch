"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import CharacterForm from "@/components/CharacterForm";
import { getCharacter } from "@/lib/storage";
import type { Character } from "@/lib/types";

export default function EditCharacterPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [character, setCharacter] = useState<Character | null | undefined>(
    undefined
  );

  useEffect(() => {
    const found = getCharacter(id);
    if (!found) {
      router.replace("/");
      return;
    }
    setCharacter(found);
  }, [id, router]);

  if (!character) return null;

  return <CharacterForm character={character} />;
}
