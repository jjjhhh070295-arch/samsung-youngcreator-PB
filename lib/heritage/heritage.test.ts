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
  computePaymentGap,
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
  it("자녀 2인은 일괄공제(5억)가 기초+인적공제(2억+1억=3억)보다 커서 일괄공제를 쓴다 — 자녀공제 이중계상 없음", () => {
    assert.equal(
      estimateExemptionWon({ hasSpouse: true, childrenCount: 2 }),
      500_000_000 + 500_000_000, // 일괄공제 5억 + 배우자공제 5억 (자녀공제는 별도로 더하지 않는다)
    );
  });

  it("자녀 7인은 기초+인적공제(2억+3.5억=5.5억)가 일괄공제(5억)를 넘어 이쪽을 쓴다", () => {
    assert.equal(
      estimateExemptionWon({ hasSpouse: true, childrenCount: 7 }),
      550_000_000 + 500_000_000, // (기초 2억+자녀공제 7×5천만=5.5억) + 배우자공제 5억
    );
  });

  it("배우자 유무가 null(미상)이면 '없음'으로 가정한다(5억, 배우자공제 없음)", () => {
    assert.equal(estimateExemptionWon({ hasSpouse: null, childrenCount: 0 }), 500_000_000);
  });
});

describe("assessHeritageDemand — 배우자/자녀 미상(null) 처리 — '미입력'이 '확인된 0'으로 둔갑하지 않는다", () => {
  it("hasSpouse:null이면 '배우자 없음'으로 가정하고, 그 사실이 가장 먼저 나온다", () => {
    const result = assessHeritageDemand(baseInput({ hasSpouse: null, childrenCount: 1 }));
    assert.equal(result.hasSpouseAssumed, true);
    assert.equal(result.reasons[0].code, "has_spouse_assumed");
  });

  it("childrenCount:null이면 2명으로 가정하고 그 사실을 표시한다", () => {
    const result = assessHeritageDemand(baseInput({ hasSpouse: true, childrenCount: null }));
    assert.equal(result.childrenCountAssumed, true);
    assert.ok(result.reasons.some((r) => r.code === "children_count_assumed"));
  });

  it("둘 다 확인됐으면(null 아님) 가정 플래그가 전부 false다", () => {
    const result = assessHeritageDemand(baseInput({ hasSpouse: false, childrenCount: 0 }));
    assert.equal(result.hasSpouseAssumed, false);
    assert.equal(result.childrenCountAssumed, false);
  });

  it("hasSpouse:null(→배우자 없음 가정)은 hasSpouse:false와 동일한 taxableExcessWon을 낸다", () => {
    const withNull = assessHeritageDemand(baseInput({ hasSpouse: null, childrenCount: 0 }));
    const withFalse = assessHeritageDemand(baseInput({ hasSpouse: false, childrenCount: 0 }));
    assert.equal(withNull.taxableExcessWon, withFalse.taxableExcessWon);
  });
});

describe("estimateInheritanceTaxRange — 배우자 미상(null) 처리", () => {
  it("hasSpouse:null이면 hasSpouseAssumed=true, hasSpouseUsed=false(가정값)로 계산된다", () => {
    const range = estimateInheritanceTaxRange({ assetSizeWon: 3_200_000_000, hasSpouse: null, childrenCount: 2 });
    assert.equal(range.hasSpouseAssumed, true);
    assert.equal(range.hasSpouseUsed, false);
    assert.ok(range.reasons.some((r) => r.code === "has_spouse_assumed"));
  });

  it("hasSpouse:null과 hasSpouse:false는 동일한 세액구간을 낸다(같은 가정을 쓰므로)", () => {
    const withNull = estimateInheritanceTaxRange({ assetSizeWon: 3_200_000_000, hasSpouse: null, childrenCount: 2 });
    const withFalse = estimateInheritanceTaxRange({ assetSizeWon: 3_200_000_000, hasSpouse: false, childrenCount: 2 });
    assert.equal(withNull.maxTaxWon, withFalse.maxTaxWon);
    assert.equal(withNull.minTaxWon, withFalse.minTaxWon);
  });
});

describe("assessHeritage — dataAssumptionsUsed 배지 플래그", () => {
  it("배우자/자녀가 전부 확인됐으면 false", () => {
    const result = assessHeritage(baseInput({ hasSpouse: true, childrenCount: 1 }));
    assert.equal(result.dataAssumptionsUsed, false);
  });

  it("배우자 유무만 미상이어도 true(자녀는 확인됐어도)", () => {
    const result = assessHeritage(baseInput({ hasSpouse: null, childrenCount: 1 }));
    assert.equal(result.dataAssumptionsUsed, true);
  });

  it("법인 고객은 taxRange가 없어도(null이어도) demand의 가정 여부만으로 판단한다", () => {
    const result = assessHeritage(baseInput({ clientType: "corporate", birthDate: null, hasSpouse: null, childrenCount: null }));
    // 법인은 demand.assessHeritageDemand에서 corporate_separate_track으로 조기 반환 —
    // hasSpouseAssumed/childrenCountAssumed가 계산되지 않으므로 false여야 한다(가정 자체를 안 함).
    assert.equal(result.dataAssumptionsUsed, false);
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
  // 임계값이 30 → 40 으로 오르면서 "자산만으로 수요가 성립하는" 지점도 올라갔다.
  // 자산 축(로그)만으로 40점에 닿으려면 과세초과 약 126억(자산 약 131억)이 필요하다.
  // 예전 기준(32억)은 이제 다른 신호 없이는 켜지지 않는다 — 의도된 변화다.
  it("자산만으로도 충분히 크면 hasNeed=true", () => {
    const result = assessHeritageDemand(baseInput({ assetSizeWon: 15_000_000_000 }));
    assert.equal(result.hasNeed, true);
    assert.ok(result.taxableExcessWon > 0);
  });

  it("자산이 중간 규모면 다른 신호 없이는 hasNeed=false", () => {
    const result = assessHeritageDemand(baseInput({ assetSizeWon: 3_200_000_000 }));
    assert.equal(result.hasNeed, false);
    assert.ok(result.taxableExcessWon > 0, "과세초과 자체는 있다 — 수요 판정만 보류한다");
  });

  it("키워드만으로는(구조 신호 없이) 수요를 만들지 못한다", () => {
    const result = assessHeritageDemand(
      baseInput({ assetSizeWon: 900_000_000, taxTagIds: ["inheritance", "gift", "trust"] }),
    );
    assert.equal(result.hasNeed, false);
  });
});

// ── 폐기된 불변식: "자산 규모가 상향요인 가산점을 압도한다" ──────────────────
// 예전 자산 축은 과세초과 30억에서 60점 만점을 찍고 그 위로 1억당 0.3점(최대 +30)을
// 더 주는 구조였다. 자산 하나가 다른 모든 신호를 눌렀고, 그 결과 이 태그는 사실상
// 자산 순위표가 됐다 — 실측에서 개인 고객 5명 중 4명이 동점 90점이었고, 부동산 비중도
// 증여 이력도 키워드도 순위를 전혀 바꾸지 못했다. 게다가 135억 위로는 전부 90점이라
// 200억과 1조를 구분하지도 못했다.
//
// 로그 스케일로 바꾸면서 이 원칙을 폐기한다. 상속 상담 수요는 자산에 비례하지 않는다 —
// 부동산이 80%고 최근 증여까지 있는 35억 고객이, 아무 신호 없는 150억 고객보다 먼저
// 상담해야 한다. 자산은 여전히 가장 큰 단일 축(60점)이지만, 이제 다른 신호가 모이면
// 자산 차이를 뒤집을 수 있다. 아래 두 테스트가 그 새 기준을 못박는다.
describe("assessHeritageDemand — 상향요인이 자산 차이를 뒤집을 수 있다", () => {
  it("J(35억, 부동산·증여·키워드 3종) score가 F(150억, 상향요인 없음)보다 높다", () => {
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
    assert.ok(J.score > F.score, `J.score=${J.score} should be > F.score=${F.score}`);
  });

  it("상향요인이 하나도 없으면 자산이 큰 쪽이 여전히 높다", () => {
    const big = assessHeritageDemand(
      baseInput({ birthDate: birthDateForAge(50), assetSizeWon: 15_000_000_000, hasSpouse: false, childrenCount: 0 }),
    );
    const small = assessHeritageDemand(
      baseInput({ birthDate: birthDateForAge(50), assetSizeWon: 3_500_000_000, hasSpouse: false, childrenCount: 0 }),
    );
    assert.ok(big.score > small.score, `big=${big.score} small=${small.score}`);
  });
});

describe("assessHeritageDemand — 자산 축은 포화되지 않는다", () => {
  // 예전 방식의 실제 결함: 135억 위로 전부 90점이라 200억과 1조가 동점이었다.
  it("200억 < 1000억 < 1조 순으로 점수가 계속 벌어진다", () => {
    const at = (won: number) =>
      assessHeritageDemand(baseInput({ assetSizeWon: won, hasSpouse: false, childrenCount: 0, birthDate: null })).score;
    const a200 = at(20_000_000_000);
    const a1000 = at(100_000_000_000);
    const a10000 = at(1_000_000_000_000);
    assert.ok(a200 < a1000, `200억=${a200} < 1000억=${a1000}`);
    assert.ok(a1000 < a10000, `1000억=${a1000} < 1조=${a10000}`);
  });
});

describe("assessHeritageDemand — 나이 축", () => {
  const asset = { assetSizeWon: 10_000_000_000, hasSpouse: false, childrenCount: 0 };

  it("같은 자산이면 나이가 많을수록 점수가 높다", () => {
    const young = assessHeritageDemand(baseInput({ ...asset, birthDate: birthDateForAge(40) }));
    const mid = assessHeritageDemand(baseInput({ ...asset, birthDate: birthDateForAge(60) }));
    const old = assessHeritageDemand(baseInput({ ...asset, birthDate: birthDateForAge(80) }));
    assert.ok(young.score < mid.score && mid.score < old.score);
  });

  it("생년월일이 없으면 나이 가산이 없다 — 모르는 것을 신호로 세지 않는다", () => {
    const known = assessHeritageDemand(baseInput({ ...asset, birthDate: birthDateForAge(80) }));
    const unknown = assessHeritageDemand(baseInput({ ...asset, birthDate: null }));
    assert.ok(unknown.score < known.score);
    assert.equal(unknown.reasons.some((r) => r.code === "age_band"), false);
  });
});

describe("assessHeritageDemand — 자녀 수는 확인된 값일 때만 가산한다", () => {
  // 가정값(관계 데이터 부재 → 2명)에 가산하면 전원이 같은 점수를 더 받아 변별력은
  // 그대로인데 점수만 부풀고, "추정"임을 표시하는 dataAssumptionsUsed 설계와도 어긋난다.
  const asset = { assetSizeWon: 10_000_000_000, hasSpouse: false };

  it("확인된 자녀 3명 이상이면 가산한다", () => {
    const two = assessHeritageDemand(baseInput({ ...asset, childrenCount: 2 }));
    const four = assessHeritageDemand(baseInput({ ...asset, childrenCount: 4 }));
    assert.ok(four.score > two.score);
    assert.equal(four.reasons.some((r) => r.code === "many_heirs"), true);
  });

  it("자녀 수가 미상(가정값)이면 가산하지 않는다", () => {
    const unknown = assessHeritageDemand(baseInput({ ...asset, childrenCount: null }));
    assert.equal(unknown.childrenCountAssumed, true);
    assert.equal(unknown.reasons.some((r) => r.code === "many_heirs"), false);
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
  // 긴급도는 demand.hasNeed 를 전제로 한다. 나이가 demand 점수에도 들어오면서, 가장 어린
  // 구간(45세, 가산 +4)까지 자산만으로 임계값(40)을 넘기려면 예전 50억으로는 부족하다.
  // 나이 밴드 매핑 자체를 검증하는 것이 목적이므로 자산을 100억으로 올려 고정한다.
  const bigAsset = { assetSizeWon: 10_000_000_000, hasSpouse: false, childrenCount: 0 };

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

  it("150억(배우자 없음, 자녀 0)의 세액은 그대로 67.9억 — 회귀 없음", () => {
    const range = estimateInheritanceTaxRange({ assetSizeWon: 15_000_000_000, hasSpouse: false, childrenCount: 0 });
    assert.equal(range.minTaxWon, range.maxTaxWon);
    assert.equal(Math.round(range.minTaxWon / 100_000_000), 68); // 67.9억 반올림
  });

  it("F(150억)와 F.regression과 별개로 F.giftAddBackWon/childrenCountAssumed는 증여·자녀 미지정 시 0/false", () => {
    const range = estimateInheritanceTaxRange({ assetSizeWon: 15_000_000_000, hasSpouse: false, childrenCount: 0 });
    assert.equal(range.giftAddBackWon, 0);
    assert.equal(range.childrenCountAssumed, false);
  });
});

describe("estimateInheritanceTaxRange — 채무 차감(순자산 기준)", () => {
  it("채무가 있으면 총자산이 아닌 순자산 기준으로 과세가액이 줄어든다", () => {
    const noDebt = estimateInheritanceTaxRange({ assetSizeWon: 3_200_000_000, hasSpouse: true, childrenCount: 0 });
    const withDebt = estimateInheritanceTaxRange({
      assetSizeWon: 3_200_000_000,
      debtWon: 500_000_000,
      hasSpouse: true,
      childrenCount: 0,
    });
    assert.equal(withDebt.breakdown.grossAssetWon, 3_200_000_000);
    assert.equal(withDebt.breakdown.debtWon, 500_000_000);
    assert.equal(withDebt.breakdown.netAssetWon, 2_700_000_000);
    assert.ok(withDebt.maxTaxWon < noDebt.maxTaxWon, `${withDebt.maxTaxWon} should be < ${noDebt.maxTaxWon}`);
  });

  it("채무가 자산을 넘으면 순자산은 0으로 clamp된다(음수 과세가액 없음)", () => {
    const range = estimateInheritanceTaxRange({
      assetSizeWon: 300_000_000,
      debtWon: 500_000_000,
      hasSpouse: false,
      childrenCount: 0,
    });
    assert.equal(range.breakdown.netAssetWon, 0);
    assert.equal(range.maxTaxWon, 0);
  });

  it("채무를 지정하지 않으면 0으로 간주하고 근거 문장도 남지 않는다", () => {
    const range = estimateInheritanceTaxRange({ assetSizeWon: 3_200_000_000, hasSpouse: true, childrenCount: 0 });
    assert.equal(range.breakdown.debtWon, 0);
    assert.equal(range.breakdown.netAssetWon, 3_200_000_000);
    assert.equal(range.reasons.some((r) => r.code === "debt_deducted"), false);
  });

  it("채무가 있으면 근거 문장에 총자산/채무/순자산이 명시된다", () => {
    const range = estimateInheritanceTaxRange({
      assetSizeWon: 3_200_000_000,
      debtWon: 500_000_000,
      hasSpouse: true,
      childrenCount: 0,
    });
    const reason = range.reasons.find((r) => r.code === "debt_deducted");
    assert.ok(reason);
    assert.match(reason!.text, /총 상속재산 32억원에서 채무\(대출 등\) 5억원을 차감한 순자산 27억원/);
  });
});

describe("computePaymentGap — 납부재원 갭 (3단계: 충분/불확실/부족)", () => {
  it("하한·상한 모두 부족(insufficient)이면 예시 문구와 동일한 형태로 단정한다", () => {
    const gap = computePaymentGap({ liquidAssetsWon: 310_000_000, minTaxWon: 370_000_000, maxTaxWon: 720_000_000 });
    assert.equal(gap.certainty, "insufficient");
    assert.equal(gap.hasGap, true);
    assert.equal(gap.maxGapWon, 410_000_000);
    assert.equal(gap.minGapWon, 60_000_000);
    const reason = gap.reasons.find((r) => r.code === "payment_gap");
    assert.ok(reason);
    assert.match(reason!.text, /예상 상속세 7\.2억원에 비해 현금성 자산이 3\.1억원으로 최대 4\.1억원이 부족합니다/);
  });

  it("상한 기준으로도 충분(sufficient)하면 위기감을 만들지 않는 안심 문장을 낸다", () => {
    const gap = computePaymentGap({ liquidAssetsWon: 1_000_000_000, minTaxWon: 370_000_000, maxTaxWon: 720_000_000 });
    assert.equal(gap.certainty, "sufficient");
    assert.equal(gap.hasGap, false);
    const reason = gap.reasons.find((r) => r.code === "payment_gap_none");
    assert.ok(reason);
    assert.doesNotMatch(reason!.text, /부족/);
  });

  it("하한은 충분한데(minGapWon<=0) 상한은 부족(maxGapWon>0)하면 uncertain — 단정하지 않고 '충분할 수도/부족할 수도'로 말한다", () => {
    // E 시나리오와 동일한 형태: -1.8억(여유) ~ 3.7억(부족)에 걸치는 경계 케이스.
    const gap = computePaymentGap({ liquidAssetsWon: 350_000_000, minTaxWon: 170_000_000, maxTaxWon: 720_000_000 });
    assert.equal(gap.minGapWon, -180_000_000);
    assert.equal(gap.maxGapWon, 370_000_000);
    assert.equal(gap.certainty, "uncertain");
    assert.equal(gap.hasGap, true);
    const reason = gap.reasons.find((r) => r.code === "payment_gap_uncertain");
    assert.ok(reason);
    assert.match(reason!.text, /배우자공제 적용 범위에 따라 재원이 충분할 수도, 최대 3\.7억원이 부족할 수도 있습니다/);
    // insufficient 전용 문구("~부족합니다.")로 단정하면 안 된다.
    assert.equal(gap.reasons.some((r) => r.code === "payment_gap"), false);
  });
});

describe("estimateInheritanceTaxRange — 상속공제는 max(기초+인적공제, 일괄공제) 하나만, 이중계상 아님", () => {
  it("32억, 배우자O, 자녀 2명 — 상한은 7.2억(일괄5억+배우자5억 적용, 자녀공제 별도 가산 없음)", () => {
    const range = estimateInheritanceTaxRange({ assetSizeWon: 3_200_000_000, hasSpouse: true, childrenCount: 2 });
    assert.equal(range.breakdown.usedBlanket, true);
    assert.equal(range.breakdown.baseOrPersonalDeductionWon, 500_000_000);
    assert.equal(range.maxTaxExemptionWon, 500_000_000 + 500_000_000);
    assert.equal(range.maxTaxWon, 720_000_000);
  });

  it("자녀 0명(F류) — 이중계상 버그와 무관, 결과 그대로", () => {
    const range = estimateInheritanceTaxRange({ assetSizeWon: 15_000_000_000, hasSpouse: false, childrenCount: 0 });
    assert.equal(range.breakdown.usedBlanket, true);
    assert.equal(range.breakdown.baseOrPersonalDeductionWon, 500_000_000);
  });

  it("자녀 6명은 아직 일괄공제(동률 이하)를 쓴다", () => {
    const range = estimateInheritanceTaxRange({ assetSizeWon: 3_200_000_000, hasSpouse: true, childrenCount: 6 });
    assert.equal(range.breakdown.usedBlanket, true);
    assert.equal(range.breakdown.baseOrPersonalDeductionWon, 500_000_000);
  });

  it("자녀 7명이면 기초+인적공제(5.5억)가 일괄공제(5억)를 넘어선다", () => {
    const range = estimateInheritanceTaxRange({ assetSizeWon: 3_200_000_000, hasSpouse: true, childrenCount: 7 });
    assert.equal(range.breakdown.usedBlanket, false);
    assert.equal(range.breakdown.personalDeductionWon, 550_000_000);
    assert.equal(range.breakdown.baseOrPersonalDeductionWon, 550_000_000);
    assert.ok(range.reasons.some((r) => r.code === "used_personal_deduction"));
  });
});

describe("estimateInheritanceTaxRange — 배우자공제는 법정상속분 한도(자녀수 반영), 정액 30억 아님", () => {
  it("32억, 배우자O, 자녀 2명 — 하한이 0원이 아니다(정액 30억 적용 시 발생하던 버그)", () => {
    const range = estimateInheritanceTaxRange({ assetSizeWon: 3_200_000_000, hasSpouse: true, childrenCount: 2 });
    assert.ok(range.minTaxWon > 0, `minTaxWon=${range.minTaxWon} should be > 0`);
    // 배우자 법정상속분 = 1.5/(1.5+2) ≈ 0.4286 → 30억 한도(spouseMax)보다 작아야 캡이 아니라
    // 법정상속분 자체가 공제 상한을 결정한다.
    assert.ok(range.minTaxExemptionWon < 500_000_000 + 3_000_000_000 + 100_000_000);
  });

  it("자녀 수를 모르면(null) 보수적으로 2명을 가정하고 결과에 표시한다", () => {
    const range = estimateInheritanceTaxRange({ assetSizeWon: 3_200_000_000, hasSpouse: true, childrenCount: null });
    assert.equal(range.childrenCountAssumed, true);
    assert.equal(range.childrenCountUsed, 2);
    assert.ok(range.reasons.some((r) => r.code === "children_count_assumed"));
  });

  it("자녀 수를 알면(0명 포함) childrenCountAssumed=false", () => {
    const range = estimateInheritanceTaxRange({ assetSizeWon: 3_200_000_000, hasSpouse: true, childrenCount: 0 });
    assert.equal(range.childrenCountAssumed, false);
    assert.equal(range.childrenCountUsed, 0);
  });

  it("하한이 0원이면 근거 사유(min_tax_zero)가 남는다", () => {
    // 자녀 0명 → 법정상속분 비율 1.0 → 30억 캡에 걸려 공제(3.5억+... )가 자산을 넘어 0원이 되는 케이스.
    const range = estimateInheritanceTaxRange({ assetSizeWon: 3_200_000_000, hasSpouse: true, childrenCount: 0 });
    assert.equal(range.minTaxWon, 0);
    assert.ok(range.reasons.some((r) => r.code === "min_tax_zero"));
  });
});

describe("estimateInheritanceTaxRange — 사전증여 10년 합산이 세액에 반영된다", () => {
  it("10년 내 증여가 있으면 없는 경우보다 세액이 높다(같은 자녀수로 비교)", () => {
    const noGift = estimateInheritanceTaxRange({
      assetSizeWon: 3_200_000_000,
      hasSpouse: true,
      childrenCount: 2,
      asOf: ASOF,
    });
    const withGift = estimateInheritanceTaxRange({
      assetSizeWon: 3_200_000_000,
      hasSpouse: true,
      childrenCount: 2,
      givenGiftEvents: [giftEvent(3, 300_000_000)],
      asOf: ASOF,
    });
    assert.equal(withGift.giftAddBackWon, 300_000_000);
    assert.ok(withGift.maxTaxWon > noGift.maxTaxWon, `${withGift.maxTaxWon} should be > ${noGift.maxTaxWon}`);
    assert.ok(withGift.minTaxWon > noGift.minTaxWon, `${withGift.minTaxWon} should be > ${noGift.minTaxWon}`);
  });

  it("10년을 넘긴 증여는 가산되지 않는다", () => {
    const range = estimateInheritanceTaxRange({
      assetSizeWon: 3_200_000_000,
      hasSpouse: true,
      childrenCount: 2,
      givenGiftEvents: [giftEvent(11, 300_000_000)],
      asOf: ASOF,
    });
    assert.equal(range.giftAddBackWon, 0);
  });

  it("근거 문장에 몇 년 전 증여가 얼마나 합산되는지 나온다", () => {
    const range = estimateInheritanceTaxRange({
      assetSizeWon: 3_200_000_000,
      hasSpouse: true,
      childrenCount: 2,
      givenGiftEvents: [giftEvent(3, 300_000_000)],
      asOf: ASOF,
    });
    const reason = range.reasons.find((r) => r.code === "gift_addback");
    assert.ok(reason);
    assert.match(reason!.text, /3년 전 증여하신 3억원은 상속재산에 합산됩니다/);
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
