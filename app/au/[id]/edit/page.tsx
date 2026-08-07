"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import UniverseForm from "@/components/UniverseForm";
import { getUniverse } from "@/lib/storage";
import type { Universe } from "@/lib/types";

export default function EditUniversePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [universe, setUniverse] = useState<Universe | null | undefined>(
    undefined
  );

  useEffect(() => {
    (async () => {
      const found = await getUniverse(id).catch(() => undefined);
      if (!found) {
        router.replace("/au");
        return;
      }
      setUniverse(found);
    })();
  }, [id, router]);

  if (!universe) return null;

  return <UniverseForm universe={universe} />;
}
