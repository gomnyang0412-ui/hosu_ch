import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { buildStoryEpub, buildStoryTxt, exportStoryFilename } from "@/lib/exportStory";
import type { Character, ObservationSession } from "@/lib/types";

const characters: Character[] = [
  { id: "c1", name: "민준", accentColor: "#000" } as Character,
  { id: "c2", name: "서연", accentColor: "#000" } as Character,
];

function makeSession(overrides: Partial<ObservationSession> = {}): ObservationSession {
  return {
    id: "s1",
    universeId: "u1",
    characterIds: ["c1", "c2"],
    topic: "첫 만남",
    episodes: [
      { index: 1, text: "첫 번째 문단.\n\n두 번째 문단." },
      { index: 2, text: "이어지는 이야기." },
    ],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("관찰 모드 이야기 내보내기", () => {
  it("txt는 제목·주제·화별 본문을 순서대로 담는다", () => {
    const text = buildStoryTxt(makeSession(), characters);
    expect(text).toContain("민준 X 서연 · 첫 만남");
    expect(text).toContain("주제: 첫 만남");
    expect(text.indexOf("제1화")).toBeLessThan(text.indexOf("제2화"));
    expect(text).toContain("첫 번째 문단.");
    expect(text).toContain("이어지는 이야기.");
  });

  it("파일명이 제목 기반으로 확장자만 다르게 만들어진다", () => {
    const session = makeSession();
    expect(exportStoryFilename(session, characters, "txt")).toBe(
      "민준 X 서연 · 첫 만남.txt"
    );
    expect(exportStoryFilename(session, characters, "epub")).toBe(
      "민준 X 서연 · 첫 만남.epub"
    );
  });

  it("epub는 mimetype이 압축 없이 저장되고 화 수만큼 챕터 파일을 만든다", async () => {
    const blob = await buildStoryEpub(makeSession(), characters);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());

    const mimetype = zip.file("mimetype");
    expect(mimetype).not.toBeNull();
    expect(await mimetype!.async("string")).toBe("application/epub+zip");

    expect(zip.file("META-INF/container.xml")).not.toBeNull();
    expect(zip.file("OEBPS/content.opf")).not.toBeNull();
    expect(zip.file("OEBPS/nav.xhtml")).not.toBeNull();
    expect(zip.file("OEBPS/text/ep0001.xhtml")).not.toBeNull();
    expect(zip.file("OEBPS/text/ep0002.xhtml")).not.toBeNull();

    const chapter1 = await zip.file("OEBPS/text/ep0001.xhtml")!.async("string");
    expect(chapter1).toContain("<p>첫 번째 문단.</p>");
    expect(chapter1).toContain("<p>두 번째 문단.</p>");

    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain("<dc:title>민준 X 서연 · 첫 만남</dc:title>");
  });

  it("표지 이미지가 있으면 이미지 파일과 매니페스트 항목이 추가된다", async () => {
    const tinyPngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const session = makeSession({
      coverImage: `data:image/png;base64,${tinyPngBase64}`,
    });
    const blob = await buildStoryEpub(session, characters);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());

    expect(zip.file("OEBPS/images/cover.png")).not.toBeNull();
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain('properties="cover-image"');
    expect(opf).toContain('<meta name="cover" content="cover-img" />');
  });
});
