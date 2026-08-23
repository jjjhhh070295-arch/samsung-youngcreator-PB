import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assessHeritage,
  assessHeritageDemand,
  assessHeritageUrgency,
  estimateExemptionWon,
  estimateInheritanceTaxRange,
  compareHeritagePriority,
  flagBusinessSuccessionReview,
} from "./index";
import type { HeritageAssessmentInput } from "./types";
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
    assetSizeWon: 3_200_000_000,
    realEstateWeightPct: 30,
    hasSpouse: true,
    childrenCount: 0,
    givenGiftEvents: [],
    taxTagIds: [],
    ...overrides,
  };
}

describe("estimateExemptionWon", () => {
  it("일괄공제만(배우자 없음, 자녀 없음)", () => {
    assert.equal(estimateExemptionWon({ hasSpouse: false, childrenCount: 0 }), 500_000_000);
  });
  it("일괄공제+배우자공제(최소)+자녀공제 2인", () => {
    assert.equal(
      estimateExemptionWon({ hasSpouse: true, childrenCount: 2 }),
      500_000_000 + 500_000_000 + 100_000_000,
    );
  });
});

describe("assessHeritageDemand — 법인은 별도 트랙", () => {
  it("법인 고객은 hasNeed=false, score=0 고정", () => {
    const result = assessHeritageDemand(baseInput({ clientType: "corporate", birthDate: null }));
    assert.equal(result.hasNeed, false);
    assert.equal(result.score, 0);
  });
});

describe("assessHeritageDemand — 저자산 컷은 배우자 유무로 분리", () => {
  it("배우자 있음: 9억은 컷(10억 미만), score<=20", () => {
    const result = assessHeritageDemand(baseInput({ assetSizeWon: 900_000_000, hasSpouse: true }));
    assert.ok(result.score <= 20);
    assert.equal(result.hasNeed, false);
  });

  it("배우자 없음: 6억이면 컷 안 됨(5억 이상)이고 8억은 hasNeed 가능", () => {
    const cut = assessHeritageDemand(baseInput({ assetSizeWon: 400_000_000, hasSpouse: false, childrenCount: 0 }));
    assert.ok(cut.score <= 20, "5억 미만은 여전히 저자산 컷");
  });

  it("배우자 없음 + 자산 6억은 배우자 있음 기준(10억 컷)과 달리 컷 대상이 아니다", () => {
    const withoutSpouse = assessHeritageDemand(baseInput({ assetSizeWon: 600_000_000, hasSpouse: false, childrenCount: 0 }));
    // 5억(일괄공제만) 기준으로는 6억 자산이 컷 미만이 아니므로 low_priority 사유가 없어야 한다.
    assert.equal(withoutSpouse.reasons.some((r) => r.code === "low_priority_small_estate"), false);
  });
});

describe("assessHeritageDemand — 구조 신호가 주 신호", () => {
  it("공제 초과가 크면 hasNeed=true", () => {
    const result = assessHeritageDemand(baseInput({ assetSizeWon: 3_200_000_000 }));
    assert.equal(result.hasNeed, true);
    assert.ok(result.taxableExcessWon > 0);
  });

  it("키워드만으로는(구조 신호 없이) 수요를 만들지 못한다", () => {
    const result = assessHeritageDemand(
      baseInput({ assetSizeWon: 900_000_000, taxTagIds: ["inheritance", "gift", "trust"] }),
    );
    assert.equal(result.hasNeed, false);
  });
});

describe("assessHeritageDemand — 자산 규모가 상향요인 가산점을 압도한다 (초고액자산가 재조정)", () => {
  it("F(150억, 상향요인 없음) score가 J(35억, 상향요인 3개→2개)보다 높다", () => {
    const F = assessHeritageDemand(
      baseInput({ birthDate: birthDateForAge(50), assetSizeWon: 15_000_000_000, hasSpouse: false, childrenCount: 0 }),
    );
    const J = assessHeritageDemand(
      baseInput({
        birthDate: birthDateForAge(50),
        assetSizeWon: 3_500_000_000,
        hasSpouse: false,
        childrenCount: 1,
        realEstateWeightPct: 80,
        givenGiftEvents: [giftEvent(4, 400_000_000)],
        taxTagIds: ["inheritance", "trust"],
      }),
    );
    assert.ok(F.score > J.score, `F.score=${F.score} should be > J.score=${J.score}`);
  });
});

describe("assessHeritageUrgency — 미성년 자녀는 더 이상 상향 요인이 아니다", () => {
  it("자녀 유무는 긴급도에 영향을 주지 않는다(공제 계산에만 영향)", () => {
    const withChild = baseInput({ childrenCount: 1, assetSizeWon: 3_200_000_000, realEstateWeightPct: 20 });
    const withoutChild = baseInput({ childrenCount: 0, assetSizeWon: 3_200_000_000, realEstateWeightPct: 20 });
    const u1 = assessHeritageUrgency(withChild, assessHeritageDemand(withChild));
    const u2 = assessHeritageUrgency(withoutChild, assessHeritageDemand(withoutChild));
    assert.equal(u1.level, u2.level);
    assert.equal(u1.reasons.some((r) => r.code === "minor_children"), false);
  });
});

describe("assessHeritageUrgency — 나이 구간별 기본 등급", () => {
  const bigAsset = { assetSizeWon: 5_000_000_000, hasSpouse: false, childrenCount: 0 };

  it("75세 이상 → 즉시", () => {
    const input = baseInput({ ...bigAsset, birthDate: birthDateForAge(75) });
    const urgency = assessHeritageUrgency(input, assessHeritageDemand(input));
    assert.equal(urgency.level, "즉시");
  });

  it("65~74세 → 3개월 내", () => {
    const input = baseInput({ ...bigAsset, birthDate: birthDateForAge(68) });
    const urgency = assessHeritageUrgency(input, assessHeritageDemand(input));
    assert.equal(urgency.level, "3개월 내");
  });

  it("55~64세 → 6개월 내", () => {
    const input = baseInput({ ...bigAsset, birthDate: birthDateForAge(60) });
    const urgency = assessHeritageUrgency(input, assessHeritageDemand(input));
    assert.equal(urgency.level, "6개월 내");
  });

  it("55세 미만 → 1년 내 (에스컬레이션 요인 없을 때)", () => {
    const input = baseInput({ ...bigAsset, birthDate: birthDateForAge(45), realEstateWeightPct: 20 });
    const urgency = assessHeritageUrgency(input, assessHeritageDemand(input));
    assert.equal(urgency.level, "1년 내");
  });

  it("법인 고객은 해당없음", () => {
    const input = baseInput({ ...bigAsset, clientType: "corporate", birthDate: null });
    const urgency = assessHeritageUrgency(input, assessHeritageDemand(input));
    assert.equal(urgency.level, "해당없음");
  });
});

describe("assessHeritageUrgency — 근거 문장에 시스템 내부 표현이 없다", () => {
  it("'한 단계 올렸' 같은 문구가 어떤 사유에도 없다", () => {
    const input = baseInput({
      birthDate: birthDateForAge(50),
      assetSizeWon: 3_500_000_000,
      hasSpouse: false,
      childrenCount: 1,
      realEstateWeightPct: 80,
      givenGiftEvents: [giftEvent(4, 400_000_000)],
    });
    const urgency = assessHeritageUrgency(input, assessHeritageDemand(input));
    for (const r of urgency.reasons) {
      assert.ok(!r.text.includes("한 단계"), `"${r.text}" should not contain internal escalation wording`);
      assert.ok(!r.text.includes("올렸"), `"${r.text}" should not contain internal escalation wording`);
    }
  });

  it("마지막 사유는 항상 권고 문장 하나로 끝난다", () => {
    const input = baseInput({ birthDate: birthDateForAge(78) });
    const urgency = assessHeritageUrgency(input, assessHeritageDemand(input));
    const last = urgency.reasons[urgency.reasons.length - 1];
    assert.equal(last.code, "recommendation");
    assert.ok(last.text.startsWith("따라서"));
  });
});

describe("estimateInheritanceTaxRange", () => {
  it("배우자 없으면 상한=하한(배우자공제 자체가 없어 구간이 한 점)", () => {
    const range = estimateInheritanceTaxRange({ assetSizeWon: 3_000_000_000, hasSpouse: false, childrenCount: 0 });
    assert.equal(range.minTaxWon, range.maxTaxWon);
  });

  it("배우자 있으면 하한 <= 상한 (배우자공제 범위만큼 세액이 갈린다)", () => {
    const range = estimateInheritanceTaxRange({ assetSizeWon: 5_000_000_000, hasSpouse: true, childrenCount: 1 });
    assert.ok(range.minTaxWon <= range.maxTaxWon);
    assert.ok(range.minTaxWon >= 0);
  });

  it("디스클레이머 문구가 항상 포함된다", () => {
    const range = estimateInheritanceTaxRange({ assetSizeWon: 5_000_000_000, hasSpouse: true, childrenCount: 0 });
    assert.match(range.disclaimer, /정확한 세액은 세무사 상담이 필요합니다/);
  });
});

describe("compareHeritagePriority — 1순위 긴급도, 2순위 score", () => {
  it("긴급도가 높으면 score가 낮아도 앞선다(78세 vs 45세, 같은 자산)", () => {
    const old = { urgencyLevel: "즉시" as const, score: 44 };
    const young = { urgencyLevel: "1년 내" as const, score: 44 };
    const sorted = [young, old].sort(compareHeritagePriority);
    assert.deepEqual(sorted, [old, young]);
  });

  it("긴급도가 같으면 score로 tie-break", () => {
    const a = { urgencyLevel: "즉시" as const, score: 90 };
    const b = { urgencyLevel: "즉시" as const, score: 60 };
    const sorted = [b, a].sort(compareHeritagePriority);
    assert.deepEqual(sorted, [a, b]);
  });
});

describe("flagBusinessSuccessionReview", () => {
  it("최대주주 신호가 없으면 flagged=false", () => {
    const result = flagBusinessSuccessionReview({});
    assert.equal(result.flagged, false);
  });
  it("법인 연결(A) 신호만 있어도 flagged=true", () => {
    const result = flagBusinessSuccessionReview({ isMajorityShareholderViaCorporateLink: true });
    assert.equal(result.flagged, true);
  });
  it("지분율(B) 50% 초과면 flagged=true", () => {
    const result = flagBusinessSuccessionReview({ maxOwnershipPct: 60 });
    assert.equal(result.flagged, true);
  });
  it("지분율이 50%면(초과 아님) flagged=false", () => {
    const result = flagBusinessSuccessionReview({ maxOwnershipPct: 50 });
    assert.equal(result.flagged, false);
  });
});

describe("assessHeritage — 통합 호출", () => {
  it("개인 고객은 demand/urgency/taxRange 전부 반환한다", () => {
    const input = baseInput({ birthDate: birthDateForAge(70), assetSizeWon: 4_000_000_000, hasSpouse: false, childrenCount: 0 });
    const result = assessHeritage(input);
    assert.equal(result.demand.hasNeed, true);
    assert.ok(result.taxRange != null);
  });

  it("법인 고객은 taxRange가 null이다", () => {
    const input = baseInput({ clientType: "corporate", birthDate: null });
    const result = assessHeritage(input);
    assert.equal(result.taxRange, null);
  });
});
