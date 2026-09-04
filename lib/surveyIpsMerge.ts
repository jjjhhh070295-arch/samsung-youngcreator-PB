// 설문 결과를 기존 IPS에 합치는 규칙 — "규제 판정 vs 사실 수집" 축.
//
// 배경: mapSurveyToIPS 는 7요인을 전부 새로 만들어 돌려준다. 호출부가 그걸 그대로
// updateClient({ ips }) 하면 상담 메모에서 뽑아낸 근거(evidence·태그)가 통째로 사라진다.
// 실제로 "집중 포지션(5)" 이 "특이사항 없음(1)" 로, "상시 인출 필요(5)" 가 고정 문구(2)로
// 덮여 없어졌다.
//
// 그래서 요인을 두 부류로 나눈다.
//   설문 소관(return·risk·timeHorizon) — 표준 문항으로 재현 가능하고, 금소법 적합성
//     판단의 근거가 되는 값. 설문이 정본이므로 그대로 채택한다.
//   상담 소관(tax·liquidity·legal·unique) — 설문 문항이 없거나(세금) 대리변수 추정에
//     그치는(유동성·법적) 값. 상담에서 확정된 근거가 있으면 그게 이긴다.
//
// 이 규칙은 lib/investmentSurvey.ts 의 resolveTaxFactor 가 tax 하나에만 적용하던 것을
// 나머지 세 요인으로 넓힌 것이다. 그 파일은 팀원 소유라 손대지 않고 호출부에서 처리한다.

import { FACTOR_META } from "./types";
import type { FactorKey, IPS, IPSFactor } from "./types";
import { TENDENCY_LABELS } from "./investmentSurvey";

/** 설문이 정본인 요인 — 설문 결과를 그대로 채택하고 reviewed:true 를 유지한다. */
export const SURVEY_OWNED_KEYS: FactorKey[] = ["return", "risk", "timeHorizon"];

/** 상담이 정본인 요인 — 기존 explicit 근거가 있으면 설문이 덮지 못한다. */
export const CONSULTATION_OWNED_KEYS: FactorKey[] = ["tax", "liquidity", "legal", "unique"];

export type SurveyChangeKind =
  /** 설문 소관 — 설문 값으로 교체 */
  | "survey"
  /** 상담 소관 — 기존 explicit 근거가 있어 설문을 무시하고 유지 */
  | "preserved"
  /** 상담 소관 — 기존 값이 없어 설문 추정치로 채움(reviewed:false) */
  | "filled"
  /** 상담 소관 — 기존에 값은 있었지만 explicit 이 아니라 설문 추정치로 교체(reviewed:false) */
  | "replaced"
  /** 전후가 동일 */
  | "unchanged";

export interface SurveyFactorChange {
  key: FactorKey;
  label: string;
  kind: SurveyChangeKind;
  before: IPSFactor;
  after: IPSFactor;
  /** 기존 evidence/inferenceHint 가 이번 적용으로 사라지는가 — PB 확인 화면에서 강조한다. */
  losesEvidence: boolean;
}

export interface SurveyMergeResult {
  merged: IPS;
  changes: SurveyFactorChange[];
  /** 실제로 값이 바뀌는 요인 수 — 0이면 확인 창을 띄울 필요가 없다. */
  changedCount: number;
}

/**
 * resolveTaxFactor 가 tax 보존 여부를 판정하던 것과 같은 기준.
 * status 만으로 판정하지 않는 이유: 태그 미매칭으로 value 가 비어버린 explicit 잔재가
 * 있을 수 있어, 점수와 값이 함께 있을 때만 "확정된 근거"로 본다.
 */
export function hasExplicitFact(f: IPSFactor | undefined): boolean {
  return !!f && f.status === "explicit" && f.score != null && !!f.value;
}

/**
 * 최종 투자성향 라벨 → 1~5 점수. TENDENCY_LABELS 순서(안정형…공격투자형)를 그대로 쓴다.
 * 라벨을 모르면 null — 그 경우 호출부가 기존 가중식 점수를 그대로 둔다.
 */
export function riskScoreFromTendency(finalTendency: string): number | null {
  const idx = TENDENCY_LABELS.indexOf(finalTendency as (typeof TENDENCY_LABELS)[number]);
  return idx === -1 ? null : idx + 1;
}

function sameFactor(a: IPSFactor, b: IPSFactor): boolean {
  return (
    a.value === b.value &&
    a.score === b.score &&
    a.status === b.status &&
    a.reviewed === b.reviewed &&
    a.evidence === b.evidence &&
    a.inferenceHint === b.inferenceHint
  );
}

const LABEL: Record<string, string> = Object.fromEntries(
  FACTOR_META.map((m) => [m.key, m.label]),
);

/**
 * 설문 IPS 를 기존 IPS 위에 합친다. 저장은 하지 않는다 — 호출부가 changes 를 PB에게
 * 보여주고 확인받은 뒤 merged 를 저장한다.
 *
 * @param finalTendency 있으면 risk 점수를 이 라벨 등급으로 통일한다(§4). 적합성 캡이
 *        점수까지 지배하게 하려는 것 — 캡이 라벨만 낮추고 점수는 가중식으로 남으면
 *        "원금 보전 필수" 응답 고객에게 risk.score=3 이 나가고, recommend.ts 는 점수만 본다.
 */
export function mergeSurveyIps(
  current: IPS,
  surveyIps: IPS,
  finalTendency?: string,
): SurveyMergeResult {
  const merged = {} as IPS;
  const changes: SurveyFactorChange[] = [];

  for (const m of FACTOR_META) {
    const key = m.key;
    const before = current[key];
    const fromSurvey = surveyIps[key];
    let after: IPSFactor;
    let kind: SurveyChangeKind;

    if (SURVEY_OWNED_KEYS.includes(key)) {
      after = { ...fromSurvey };
      if (key === "risk" && finalTendency) {
        const graded = riskScoreFromTendency(finalTendency);
        if (graded != null) after.score = graded;
      }
      kind = "survey";
    } else if (hasExplicitFact(before)) {
      after = { ...before };
      kind = "preserved";
    } else {
      // 설문 추정치는 PB 검토 전이다. mapSurveyToIPS 가 붙인 reviewed:true 를 되돌린다.
      after = { ...fromSurvey, reviewed: false };
      kind = before.value || before.score != null ? "replaced" : "filled";
    }

    if (kind !== "preserved" && sameFactor(before, after)) kind = "unchanged";

    // 근거 소실 판정: evidence 뿐 아니라 inferenceHint 도 근거로 친다([A-n] 배지의 출처).
    // evidence 가 빈 문자열이면 includes("") 가 항상 true 라, 그대로 쓰면 힌트 소실을 놓친다.
    const hadBasis = !!(before.evidence || before.inferenceHint);
    const keptEvidence = !!before.evidence && after.evidence.includes(before.evidence);

    merged[key] = after;
    changes.push({
      key,
      label: LABEL[key] ?? key,
      kind,
      before,
      after,
      losesEvidence: kind !== "preserved" && kind !== "unchanged" && hadBasis && !keptEvidence,
    });
  }

  return {
    merged,
    changes,
    changedCount: changes.filter((c) => c.kind !== "preserved" && c.kind !== "unchanged").length,
  };
}

// ── 상담 중 AI 분석 병합 ─────────────────────────────────────────────────────
// ConsultationModal의 "① 상담 내용 입력·분석"이 /api/analyze 결과를 setDraftIps(ips)로
// 통째로 교체하고 있었다. AI가 못 뽑은 요인은 status:"empty"인 빈 객체로 오는데, 그걸
// 그대로 덮어쓰면 이미 채워져 있던(설문 반영·직전 상담 확정 등) 값이 통째로 사라진다.
//
// 규칙은 설문 병합보다 단순하다 — 요인 성격에 따른 소관 구분이 없다.
//   - AI가 값을 못 채운 요인(status:"empty", value/score/inferenceHint 전부 없음)은
//     기존 draft 값을 그대로 둔다.
//   - AI가 값을 채운 요인 중, 기존 값이 이미 hasExplicitFact(explicit+score+value 완비)
//     라면 "확정된 근거를 덮어쓰는 것"이라 PB 확인이 필요하다(kind: "replaced").
//   - 기존 값이 explicit 근거를 안 갖췄으면(비어있거나 inferred) 그냥 채운다(kind: "filled").
// SurveyApplyDiffModal을 그대로 재사용한다 — kind 값을 기존 SurveyChangeKind 안에서
// 고른 것도 그래서다(라벨 문구가 "설문" 기준이라 상담 문맥에는 다소 안 맞지만, 모달을
// 새로 만들지 않고 재사용하라는 지시라 이 문구 불일치는 감수한다).
export interface ConsultationMergeResult {
  merged: IPS;
  changes: SurveyFactorChange[];
  /** true면 hasExplicitFact를 덮어쓰는 요인이 있다는 뜻 — 확인 모달을 띄워야 한다. */
  needsConfirmation: boolean;
}

function aiFilledFactor(f: IPSFactor): boolean {
  return f.status !== "empty" && !!(f.value || f.score != null || f.inferenceHint);
}

export function mergeConsultationAiIps(current: IPS, aiIps: IPS): ConsultationMergeResult {
  const merged = {} as IPS;
  const changes: SurveyFactorChange[] = [];

  for (const m of FACTOR_META) {
    const key = m.key;
    const before = current[key];
    const fromAi = aiIps[key];
    let after: IPSFactor;
    let kind: SurveyChangeKind;

    if (!aiFilledFactor(fromAi)) {
      after = before;
      kind = "unchanged";
    } else if (hasExplicitFact(before)) {
      after = fromAi;
      kind = "replaced";
    } else {
      after = fromAi;
      kind = "filled";
    }

    if (sameFactor(before, after)) kind = "unchanged";

    const hadBasis = !!(before.evidence || before.inferenceHint);
    const keptEvidence = !!before.evidence && after.evidence.includes(before.evidence);

    merged[key] = after;
    changes.push({
      key,
      label: LABEL[key] ?? key,
      kind,
      before,
      after,
      losesEvidence: kind !== "unchanged" && hadBasis && !keptEvidence,
    });
  }

  return {
    merged,
    changes,
    needsConfirmation: changes.some((c) => c.kind === "replaced"),
  };
}
