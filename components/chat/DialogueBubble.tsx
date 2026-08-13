import CharacterAvatar from "@/components/CharacterAvatar";
import { sourceLabel } from "@/lib/modelLabel";
import type { Character } from "@/lib/types";

/**
 * 대사(지문+대사) 한 마디. 1:1 채팅과 멀티 대화방이 거의 똑같이 그리던 걸
 * 하나로 모았다. 유일한 차이는 이름표 표시 여부 — 멀티 대화방은 참가자가
 * 여럿이라 누구 말인지 이름을 보여주고, 1:1은 항상 같은 한 명이라 이름을
 * 안 보여준다(showName으로 그 차이만 남겨둔다).
 */
export default function DialogueBubble({
  speaker,
  act,
  say,
  model,
  keyIndex,
  showName = false,
}: {
  speaker: Pick<Character, "name" | "image" | "accentColor">;
  act?: string;
  say: string;
  model?: string;
  keyIndex?: number;
  showName?: boolean;
}) {
  return (
    <div className="flex items-end gap-2">
      <CharacterAvatar character={speaker} size="sm" />
      <div className="flex max-w-[75%] flex-col gap-0.5 md:max-w-[420px]">
        <div className="card-shadow whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-card px-3 py-2 text-sm leading-relaxed">
          {showName && (
            <p
              className="mb-0.5 text-xs font-semibold"
              style={{ color: speaker.accentColor }}
            >
              {speaker.name}
            </p>
          )}
          {act && <p className="mb-1 text-xs italic text-muted">{act}</p>}
          {say}
        </div>
        {sourceLabel(model, keyIndex) && (
          <span className="pl-1 text-[10px] text-muted/70">
            {sourceLabel(model, keyIndex)}
          </span>
        )}
      </div>
    </div>
  );
}
