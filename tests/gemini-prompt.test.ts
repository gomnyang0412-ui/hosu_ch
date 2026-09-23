import { describe, expect, it } from "vitest";
import {
  characterLines,
  observationRelationshipRule,
  worldBlock,
} from "@/lib/gemini";
import type { CharacterProfile, Universe } from "@/lib/types";

const character: CharacterProfile = {
  name: "해원",
  oneLiner: "도시의 기록자",
  goal: "사라진 기록을 찾는다",
  appearance: "검은 코트",
  scentNote: "비 냄새",
  personality: "차분하지만 집요하다",
  speechStyle: "짧고 낮게 말한다",
  background: "원작의 오래된 도서관에서 자랐다",
  lifeHistory: "원작 도시를 떠난 적이 없다",
  relatedCharacters: "원작의 동료와 오래 얽혀 있다",
  romance: "원작의 연인을 기다린다",
};

const au: Universe = {
  id: "au-noir",
  type: "au",
  title: "느와르 AU",
  worldSetting: "비가 멈추지 않는 항구 도시",
  faction: "항만 조사국",
  relations: ["해원과 도윤은 불편한 동료다"],
  glossary: "백야: 도시의 정전 현상",
  summary: "서로를 믿지 못하는 수사극",
  createdAt: 1,
  updatedAt: 1,
};

describe("Gemini 캐릭터 프롬프트 경계", () => {
  it("ORG에서는 현재 캐릭터 설정 전체를 유지한다", () => {
    const text = characterLines(character, false).join("\n");

    expect(text).toContain("한 줄 소개: 도시의 기록자");
    expect(text).toContain("목표: 사라진 기록을 찾는다");
    expect(text).toContain("외형 특징: 검은 코트");
    expect(text).toContain("배경 이야기: 원작의 오래된 도서관에서 자랐다");
    expect(text).toContain("연관 인물: 원작의 동료와 오래 얽혀 있다");
    expect(text).toContain("애정 관계: 원작의 연인을 기다린다");
  });

  it("AU에서는 이름·성격·말투만 유지하고 원작 서사를 제외한다", () => {
    expect(characterLines(character, true)).toEqual([
      "이름: 해원",
      "성격: 차분하지만 집요하다",
      "말투: 짧고 낮게 말한다",
    ]);
  });

  it("AU 세계관 블록은 현재 세계관과 관계 설정을 모두 전달한다", () => {
    const text = worldBlock(au);

    expect(text).toContain('"느와르 AU"라는 AU');
    expect(text).toContain("[관계]가 없으면 기존 인연을 임의로 만들지 않는다");
    expect(text).toContain("[세계관]\n비가 멈추지 않는 항구 도시");
    expect(text).toContain("[파벌]\n항만 조사국");
    expect(text).toContain("- 관계 1: 해원과 도윤은 불편한 동료다");
    expect(text).toContain("[용어 및 설정]\n백야: 도시의 정전 현상");
    expect(text).toContain("[요약]\n서로를 믿지 못하는 수사극");
  });

  it("관계가 비어 있으면 관찰 모드가 기존 인연을 임의로 만들지 못하게 한다", () => {
    const emptyRelations = { ...au, relations: Array(10).fill("") };
    const text = observationRelationshipRule(emptyRelations);

    expect(text).toContain("세계관 차원에서 미리 정해진 관계가 없다는 뜻");
    expect(text).toContain("빈칸을 자유롭게 보충하라는 뜻이 아니다");
    expect(text).toContain("가족·친척·연인·배우자·친구·동료·상하·주종 관계");
    expect(text).toContain("이야기 본문에서 실제로 만남·사건·대화가 쌓인 결과");
  });

  it("설정한 관계가 있으면 관찰 모드의 시작 관계로만 사용한다", () => {
    expect(observationRelationshipRule(au)).toContain(
      "인물 간 시작 관계는 위 [관계]에 적힌 내용만 사실로 취급한다"
    );
  });
});
