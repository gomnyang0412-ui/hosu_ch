"use client";

import { PLAYER_ANONYMOUS } from "@/lib/character";
import type { Character } from "@/lib/types";

export default function RolePickerPanel({
  open,
  character,
  allCharacters,
  voiceCharacter,
  playerCharacter,
  onChooseVoice,
  onChoosePlayer,
  onClose,
}: {
  open: boolean;
  character: Character;
  allCharacters: Character[];
  voiceCharacter: Character;
  playerCharacter: Character | null;
  onChooseVoice: (nextVoiceId: string) => void;
  onChoosePlayer: (nextPlayerId: string) => void;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div className="flex flex-col gap-2 border-b border-border glass px-3 py-3">
      <label className="flex flex-col gap-1 text-xs text-muted">
        AI가 연기
        <select
          value={voiceCharacter.id}
          onChange={(e) => onChooseVoice(e.target.value)}
          className="rounded-xl border border-border bg-background p-2 text-sm text-foreground outline-none focus:border-primary/50"
        >
          {allCharacters.map((c) => (
            <option key={c.id} value={c.id} disabled={playerCharacter?.id === c.id}>
              {c.id === character.id ? `${c.name} (기본, 본인)` : c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted">
        나는
        <select
          value={playerCharacter?.id ?? PLAYER_ANONYMOUS}
          onChange={(e) => onChoosePlayer(e.target.value)}
          className="rounded-xl border border-border bg-background p-2 text-sm text-foreground outline-none focus:border-primary/50"
        >
          <option value={PLAYER_ANONYMOUS}>이름 없는 사용자 (기본)</option>
          {allCharacters.map((c) => (
            <option key={c.id} value={c.id} disabled={c.id === voiceCharacter.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={onClose}
        className="self-end rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted"
      >
        닫기
      </button>
    </div>
  );
}
