import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assessHeritage, assessHeritageDemand, assessHeritageUrgency, estimateExemptionWon } from "./index";
import type { HeritageAssessmentInput, HeritageChild } from "./types";
import type { TransferEvent } from "../types";

const ASOF = new Date("2026-08-24T00:00:00.000Z");

function birthDateForAge(age: number): string {
  const d = new Date(ASOF);
  d.setFullYear(d.getFullYear() - age);
  return d.toISOString().slice(0, 10);
}

function giftEvent(yearsAgo: number, amount: number): TransferEvent {
  const d = new Date(ASOF);
  d.setFullYear(d.getFullYear() - yearsAgo);
  return {
    id: `gift-${yearsAgo}-${amount}`,
    eventType: "gift",
    fromPartyId: "client-1",
    toPartyId: "child-1",
    assetKind: "cash",
    assetRef: null,
    amount,
    eventDate: d.toISOString().slice(0, 10),
    note: null,
    createdAt: d.toISOString(),
  };
}

function baseInput(overrides: Partial<HeritageAssessmentInput> = {}): HeritageAssessmentInput {
  return {
    asOf: ASOF,
    clientType: "individual",
    birthDate: birthDateForAge(45),
    assetSizeWon: 1_500_000_000,
    realEstateWeightPct: 30,
    hasSpouse: true,
    children: [],
    givenGiftEvents: [],
    taxTagIds: [],
    ...overrides,
  };
}

describe("estimateExemptionWon", () => {
  it("일괄공제만(배우자 없음, 자녀 없음)", () => {
    assert.equal(estimateExemptionWon({ hasSpouse: false, children: [] }), 500_000_000);
  });
  it("일괄공제+배우자공제+자녀공제 2인", () => {
    const children: HeritageChild[] = [{}, {}];
    assert.equal(estimateExemptionWon({ hasSpouse: true, children }), 500_000_000 + 500_000_000 + 100_000_000);
  });
});

describe("assessHeritageDemand — 저자산 우선순위 하향", () => {
  it("총자산 10억 미만이면 태그가 있어도 score가 20을 넘지 않는다", () => {
    const result = assessHeritageDemand(
      baseInput({ assetSizeWon: 800_000_000, taxTagIds: ["inheritance", "gift", "trust"] }),
    );
    assert.ok(result.score <= 20, `score=${result.score}`);
    assert.equal(result.hasNeed, false);
  });

  it("총자산 8억 + 배우자 없음이어도 공제(5억) 초과분이 작아 수요 없음", () => {
    const result = assessHeritageDemand(baseInput({ assetSizeWon: 800_000_000, hasSpouse: false }));
    assert.equal(result.hasNeed, false);
  });
});

describe("assessHeritageDemand — 구조 신호가 주 신호", () => {
  it("공제 초과가 크면(30억 자산, 배우자+자녀 없음) hasNeed=true", () => {
    const result = assessHeritageDemand(baseInput({ assetSizeWon: 3_000_000_000, hasSpouse: false, children: [] }));
    assert.equal(result.hasNeed, true);
    assert.ok(result.taxableExcessWon > 0);
  });

  it("자산이 공제 이내면(9억, 배우자 있음) 키워드 없이도 hasNeed=false", () => {
    const result = assessHeritageDemand(baseInput({ assetSizeWon: 900_000_000, hasSpouse: true, children: [] }));
    assert.equal(result.taxableExcessWon, 0);
    assert.equal(result.hasNeed, false);
  });

  it("키워드만으로는(구조 신호 없이) 수요를 만들지 못한다 — 보조 신호이기 때문", () => {
    const result = assessHeritageDemand(
      baseInput({ assetSizeWon: 900_000_000, hasSpouse: true, children: [], taxTagIds: ["inheritance", "gift", "trust"] }),
    );
    assert.equal(result.hasNeed, false, "구조 신호(공제 이내) 없이 키워드만으로는 수요 판정 안 됨");
  });

  it("부동산 비중 70%+ 은 점수를 올리지만 그 자체로 수요를 만들지는 않는다(자산이 공제 이내인 경우)", () => {
    const result = assessHeritageDemand(baseInput({ assetSizeWon: 900_000_000, realEstateWeightPct: 80 }));
    assert.equal(result.hasNeed, false);
  });

  it("최근 10년 내 증여 이력은 점수를 올린다", () => {
    const withGift = assessHeritageDemand(
      baseInput({ assetSizeWon: 1_800_000_000, givenGiftEvents: [giftEvent(3, 300_000_000)] }),
    );
    const withoutGift = assessHeritageDemand(baseInput({ assetSizeWon: 1_800_000_000 }));
    assert.ok(withGift.score > withoutGift.score);
  });

  it("10년 초과 증여 이력은 반영하지 않는다", () => {
    const result = assessHeritageDemand(
      baseInput({ assetSizeWon: 1_800_000_000, givenGiftEvents: [giftEvent(12, 300_000_000)] }),
    );
    const withoutGift = assessHeritageDemand(baseInput({ assetSizeWon: 1_800_000_000 }));
    assert.equal(result.score, withoutGift.score);
  });
});

describe("assessHeritageUrgency — 나이 구간별 기본 등급", () => {
  const bigAsset = { assetSizeWon: 5_000_000_000, hasSpouse: false, children: [] as HeritageChild[] };

  it("75세 이상 → 즉시", () => {
    const input = baseInput({ ...bigAsset, birthDate: birthDateForAge(75) });
    const demand = assessHeritageDemand(input);
    const urgency = assessHeritageUrgency(input, demand);
    assert.equal(urgency.level, "즉시");
  });

  it("65~74세 → 3개월 내", () => {
    const input = baseInput({ ...bigAsset, birthDate: birthDateForAge(68) });
    const demand = assessHeritageDemand(input);
    const urgency = assessHeritageUrgency(input, demand);
    assert.equal(urgency.level, "3개월 내");
  });

  it("55~64세 → 6개월 내", () => {
    const input = baseInput({ ...bigAsset, birthDate: birthDateForAge(60) });
    const demand = assessHeritageDemand(input);
    const urgency = assessHeritageUrgency(input, demand);
    assert.equal(urgency.level, "6개월 내");
  });

  it("55세 미만 → 1년 내 (에스컬레이션 요인 없을 때)", () => {
    const input = baseInput({ ...bigAsset, birthDate: birthDateForAge(45), realEstateWeightPct: 20 });
    const demand = assessHeritageDemand(input);
    const urgency = assessHeritageUrgency(input, demand);
    assert.equal(urgency.level, "1년 내");
  });

  it("수요가 없으면(hasNeed=false) 나이와 무관하게 해당없음", () => {
    const input = baseInput({ birthDate: birthDateForAge(80), assetSizeWon: 800_000_000 });
    const demand = assessHeritageDemand(input);
    assert.equal(demand.hasNeed, false);
    const urgency = assessHeritageUrgency(input, demand);
    assert.equal(urgency.level, "해당없음");
  });

  it("법인 고객은 해당없음", () => {
    const input = baseInput({ ...bigAsset, clientType: "corporate", birthDate: null });
    const demand = assessHeritageDemand(input);
    const urgency = assessHeritageUrgency(input, demand);
    assert.equal(urgency.level, "해당없음");
  });
});

describe("assessHeritageUrgency — 상향 요인", () => {
  const bigAsset = { assetSizeWon: 5_000_000_000, hasSpouse: false, children: [] as HeritageChild[] };

  it("부동산 비중 70%+ 는 한 단계 상향한다", () => {
    const low = assessHeritageUrgency(
      baseInput({ ...bigAsset, birthDate: birthDateForAge(45), realEstateWeightPct: 20 }),
      assessHeritageDemand(baseInput({ ...bigAsset, birthDate: birthDateForAge(45), realEstateWeightPct: 20 })),
    );
    const high = assessHeritageUrgency(
      baseInput({ ...bigAsset, birthDate: birthDateForAge(45), realEstateWeightPct: 75 }),
      assessHeritageDemand(baseInput({ ...bigAsset, birthDate: birthDateForAge(45), realEstateWeightPct: 75 })),
    );
    assert.equal(low.level, "1년 내");
    assert.equal(high.level, "6개월 내");
  });

  it("최근 10년 내 증여 이력은 한 단계 상향한다", () => {
    const input = baseInput({ ...bigAsset, birthDate: birthDateForAge(45), givenGiftEvents: [giftEvent(2, 500_000_000)] });
    const urgency = assessHeritageUrgency(input, assessHeritageDemand(input));
    assert.equal(urgency.level, "6개월 내");
  });

  it("미성년 자녀가 있으면 한 단계 상향한다", () => {
    const input = baseInput({
      ...bigAsset,
      birthDate: birthDateForAge(45),
      children: [{ birthDate: birthDateForAge(10) }],
    });
    // 자녀공제 반영해도 여전히 수요가 남도록 자산을 좀 더 키운다
    const urgency = assessHeritageUrgency(input, assessHeritageDemand(input));
    assert.equal(urgency.level, "6개월 내");
  });

  it("55세 미만이라도 과세초과액이 100억 이상이면 한 단계 상향한다", () => {
    const input = baseInput({ birthDate: birthDateForAge(45), assetSizeWon: 15_000_000_000, hasSpouse: false, children: [] });
    const urgency = assessHeritageUrgency(input, assessHeritageDemand(input));
    assert.equal(urgency.level, "6개월 내");
  });

  it("여러 상향 요인이 겹치면 '즉시'까지 올라가되 그 이상은 안 간다(cap)", () => {
    const input = baseInput({
      birthDate: birthDateForAge(50),
      assetSizeWon: 3_500_000_000,
      hasSpouse: false,
      children: [{ birthDate: birthDateForAge(10) }],
      realEstateWeightPct: 80,
      givenGiftEvents: [giftEvent(4, 400_000_000)],
    });
    const demand = assessHeritageDemand(input);
    const urgency = assessHeritageUrgency(input, demand);
    assert.equal(urgency.level, "즉시");
  });
});

describe("assessHeritage — 통합 호출", () => {
  it("demand와 urgency를 함께 반환한다", () => {
    const input = baseInput({ birthDate: birthDateForAge(70), assetSizeWon: 4_000_000_000, hasSpouse: false, children: [] });
    const result = assessHeritage(input);
    assert.equal(result.demand.hasNeed, true);
    assert.equal(result.urgency.level, "3개월 내");
  });
});
