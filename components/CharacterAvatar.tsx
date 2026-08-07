import type { Character } from "@/lib/types";

const SIZE_CLASSES = {
  sm: "h-9 w-9 text-sm",
  md: "h-14 w-14 text-lg",
  lg: "h-20 w-20 text-2xl",
} as const;

export default function CharacterAvatar({
  character,
  size = "md",
}: {
  character: Pick<Character, "name" | "image" | "accentColor">;
  size?: keyof typeof SIZE_CLASSES;
}) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden rounded-2xl font-semibold text-white ${SIZE_CLASSES[size]}`}
      style={{ backgroundColor: character.accentColor }}
    >
      {character.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={character.image}
          alt={character.name}
          className="h-full w-full object-cover"
        />
      ) : (
        <span>{character.name.slice(0, 1)}</span>
      )}
    </div>
  );
}
