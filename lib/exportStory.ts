import JSZip from "jszip";
import type { Character, ObservationSession, StoryEpisode } from "@/lib/types";

/** 관찰 모드 이야기 하나를 txt/epub로 내보내는 유틸. 브라우저(클라이언트)
 *  전용 — Blob·다운로드 링크를 만들어야 해서 서버 라우트에서는 안 쓴다. */

function resolveTitle(session: ObservationSession, characters: Character[]): string {
  const names = session.characterIds
    .map((id) => characters.find((c) => c.id === id)?.name)
    .filter((n): n is string => !!n);
  const namePart = names.join(" X ") || "이야기";
  return session.topic.trim() ? `${namePart} · ${session.topic.trim()}` : namePart;
}

/** 파일 이름으로 못 쓰는 문자를 정리 */
function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || "이야기";
}

export function buildStoryTxt(
  session: ObservationSession,
  characters: Character[]
): string {
  const title = resolveTitle(session, characters);
  const parts = [title, `주제: ${session.topic.trim()}`, ""];
  session.episodes.forEach((ep) => {
    parts.push(`제${ep.index}화`, "", ep.text.trim(), "", "");
  });
  return parts.join("\n").trim() + "\n";
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function paragraphsToXhtml(text: string): string {
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeXml(line)}</p>`)
    .join("\n    ");
}

// 화 사이를 완전히 안 나누고 하나로 이어붙이되, 시간 경과·장면 전환이
// 있었을 지점을 표시할 방법이 아예 없어지진 않도록 아주 옅은 "숨 고르는"
// 지점만 남긴다. 화마다 별도 xhtml 파일로 나누면 리더가 파일이 바뀔 때
// "다음 챕터"로 점프하듯 넘어가는 느낌을 주는데(2026-09-02 사용자 피드백),
// 화 전부를 파일 하나로 합치면 페이지 넘김이 화 경계와 무관하게 글자
// 양에 따라 자연스럽게만 일어나서 이 문제가 없다 — 그 안에 있는 이
// 구분 기호는 그냥 본문 중간의 작은 장식일 뿐, 챕터 전환을 만들지 않는다.
const SCENE_BREAK_XHTML = `<p style="text-align: center; margin: 1.5em 0; letter-spacing: 0.3em;">· · ·</p>`;

function storyBodyXhtml(title: string, episodes: StoryEpisode[]): string {
  const body = episodes
    .map((ep) => paragraphsToXhtml(ep.text))
    .join(`\n    ${SCENE_BREAK_XHTML}\n    `);
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ko" lang="ko">
<head>
  <meta charset="utf-8" />
  <title>${escapeXml(title)}</title>
</head>
<body>
  <h1>${escapeXml(title)}</h1>
  <div>
    ${body}
  </div>
</body>
</html>
`;
}

/** "data:image/png;base64,...." 형태의 dataURL을 base64 본문과 확장자로 분리 */
function splitDataUrl(dataUrl: string): { base64: string; ext: string } | null {
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] === "jpg" ? "jpeg" : match[1];
  return { base64: match[2], ext: mime === "jpeg" ? "jpg" : mime };
}

export async function buildStoryEpub(
  session: ObservationSession,
  characters: Character[]
): Promise<Blob> {
  const title = resolveTitle(session, characters);
  const zip = new JSZip();

  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });

  zip.file(
    "META-INF/container.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>
`
  );

  const cover = session.coverImage ? splitDataUrl(session.coverImage) : null;
  if (cover) {
    zip.file(`OEBPS/images/cover.${cover.ext}`, cover.base64, { base64: true });
  }

  zip.file("OEBPS/text/story.xhtml", storyBodyXhtml(title, session.episodes));

  zip.file(
    "OEBPS/nav.xhtml",
    `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ko" lang="ko">
<head>
  <meta charset="utf-8" />
  <title>목차</title>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>목차</h1>
    <ol>
      <li><a href="text/story.xhtml">${escapeXml(title)}</a></li>
    </ol>
  </nav>
</body>
</html>
`
  );

  const uuid = crypto.randomUUID();
  const modified = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const manifestItems = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />`,
    ...(cover
      ? [
          `<item id="cover-img" href="images/cover.${cover.ext}" media-type="image/${cover.ext === "jpg" ? "jpeg" : cover.ext}" properties="cover-image" />`,
        ]
      : []),
    `<item id="story" href="text/story.xhtml" media-type="application/xhtml+xml" />`,
  ].join("\n    ");
  const spineItems = `<itemref idref="story" />`;

  zip.file(
    "OEBPS/content.opf",
    `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>ko</dc:language>
    <dc:creator>hiátus</dc:creator>
    <meta property="dcterms:modified">${modified}</meta>
    ${cover ? `<meta name="cover" content="cover-img" />` : ""}
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>
`
  );

  return zip.generateAsync({ type: "blob", mimeType: "application/epub+zip" });
}

/** Blob을 파일로 다운로드 트리거 (브라우저 전용) */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportStoryFilename(
  session: ObservationSession,
  characters: Character[],
  ext: "txt" | "epub"
): string {
  return `${sanitizeFilename(resolveTitle(session, characters))}.${ext}`;
}
