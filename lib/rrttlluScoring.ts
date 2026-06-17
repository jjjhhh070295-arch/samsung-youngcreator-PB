// 정성 요인(세금·법적·고유) "태그 + 강도" 채점 — rrttllu_scoring.py 표를 TS로 이식.
// 철학: 깊은 분석·절세 플랜이 아니라 "어떤 요인이 있고(태그) 얼마나 센지(강도 1~5)"만.
// 점수는 LLM 없이 규칙으로 산출 → 빠르고 일관·무료. portfolio.ts는 점수 1~5만 받으므로 호환.

import type { FactorKey } from "./types";

export interface FactorTag {
  id: string;
  label: string;
  score: number; // 1~5 강도(=severity/floor)
}

// 세금: 한계세율 + 종합과세 + 시나리오 태그. 강도(=severity/floor)의 최대값을 점수로.
// (_TAX_LEVEL_SCORE + 종합과세 + _SCENARIO_FLOOR 이식, 태그 모델로 통일)
export const TAX_TAGS: FactorTag[] = [
  // 한계세율 밴드
  { id: "level_low", label: "한계세율 낮음(~24%)", score: 2 },
  { id: "level_mid", label: "한계세율 중간(24~38%)", score: 3 },
  { id: "level_high", label: "한계세율 높음(38%+)", score: 5 },
  // 금융소득종합과세
  { id: "fin_income", label: "금융소득종합과세 대상", score: 4 },
  // 시나리오
  { id: "philanthropy", label: "공익·기부", score: 2 },
  { id: "gift", label: "증여", score: 3 },
  { id: "divorce", label: "이혼(재산분할)", score: 3 },
  { id: "real_estate", label: "부동산(양도·종부세)", score: 3 },
  { id: "retirement", label: "은퇴·연금", score: 3 },
  { id: "inheritance", label: "상속", score: 4 },
  { id: "corporate", label: "법인(법인세·배당·승계)", score: 4 },
  { id: "offshore", label: "해외·비거주", score: 4 },
];

// 법적/규제: _LEGAL_SEVERITY 이식
export const LEGAL_TAGS: FactorTag[] = [
  { id: "none", label: "제약 없음", score: 1 },
  { id: "corporate", label: "법인 자금", score: 3 },
  { id: "trust", label: "신탁", score: 3 },
  { id: "insider", label: "임원·최대주주", score: 4 },
  { id: "guardianship", label: "성년후견", score: 4 },
  { id: "foundation", label: "공익재단", score: 5 },
];

// 유동성: 자금 필요 시점(급할수록 강도↑). SCORE_RUBRIC.liquidity 밴드를 태그로.
export const LIQUIDITY_TAGS: FactorTag[] = [
  { id: "long", label: "장기간 묶어둘 수 있음", score: 1 },
  { id: "some_years", label: "수년 내 일부 필요", score: 2 },
  { id: "3to5y", label: "3~5년 내 목돈 필요", score: 3 },
  { id: "1to2y", label: "1~2년 내 목돈 필요", score: 4 },
  { id: "anytime", label: "상시 인출 필요", score: 5 },
];

// 고유 상황: _UNIQUE_SEVERITY 이식
export const UNIQUE_TAGS: FactorTag[] = [
  { id: "none", label: "특이사항 없음", score: 1 },
  { id: "specific_asset", label: "특정자산 보유의향", score: 2 },
  { id: "esg", label: "ESG·종교 제약", score: 3 },
  { id: "family_gov", label: "가족 거버넌스", score: 3 },
  { id: "concentrated", label: "집중 포지션", score: 5 },
];

// 태그 기반 정성 요인 (이 키들은 태그 선택으로 채점)
export const TAG_FACTORS: Partial<Record<FactorKey, FactorTag[]>> = {
  tax: TAX_TAGS,
  liquidity: LIQUIDITY_TAGS,
  legal: LEGAL_TAGS,
  unique: UNIQUE_TAGS,
};

export function isTagFactor(key: FactorKey): boolean {
  return key in TAG_FACTORS;
}

// 선택된 태그 라벨들 → 강도 점수(최대값). 선택 없으면 null.
export function scoreFromTagLabels(key: FactorKey, labels: string[]): number | null {
  const tags = TAG_FACTORS[key];
  if (!tags || labels.length === 0) return null;
  const scores = labels
    .map((l) => tags.find((t) => t.label === l)?.score ?? 0)
    .filter((s) => s > 0);
  if (scores.length === 0) return null;
  return Math.min(5, Math.max(...scores));
}

// LLM 출력/원문에서 해당 요인의 태그를 추출(라벨이 텍스트에 포함되면 선택). → 라벨·강도.
// 녹취 분석이 정성 태그를 자동으로 골라주는 데 사용(정확 라벨 매칭 + 부분포함 허용).
export function matchTagsInText(key: FactorKey, text: string): { labels: string[]; score: number | null } {
  const tags = TAG_FACTORS[key];
  if (!tags || !text) return { labels: [], score: null };
  const labels = tags.filter((t) => text.includes(t.label)).map((t) => t.label);
  return { labels, score: scoreFromTagLabels(key, labels) };
}

// 프롬프트용: 요인별 허용 태그 라벨 목록 텍스트
export function tagOptionsForPrompt(): string {
  return (Object.keys(TAG_FACTORS) as FactorKey[])
    .map((k) => `- ${k}: ${(TAG_FACTORS[k] ?? []).map((t) => t.label).join(" | ")}`)
    .join("\n");
}

// value 문자열(", "로 join된 라벨) ↔ 라벨 배열
export function parseTagValue(value: string): string[] {
  return (value || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// ── 성향등급 (금융투자협회 5단계). R·R 기반, 7요인 '합산' 아님 ──
export const PROPENSITY_LABEL: Record<number, string> = {
  1: "안정형",
  2: "안정추구형",
  3: "위험중립형",
  4: "적극투자형",
  5: "공격투자형",
};

export interface Propensity {
  grade: number; // 1~5
  label: string;
  returnMismatch: boolean; // 목표수익률이 위험성향 대비 2단계↑ → 정합성 경고
}

// 위험 점수(=effective risk)로 등급 결정. 목표수익률이 위험여력보다 2단계 이상 높으면 경고.
// (재무능력 2축은 재무 입력 추가 시 effective=min(허용도,능력)으로 확장 가능)
export function derivePropensity(
  returnScore: number | null,
  riskScore: number | null,
): Propensity | null {
  if (riskScore == null) return null; // 위험성향 점수 없으면 등급 산출 불가
  const grade = Math.max(1, Math.min(5, Math.round(riskScore)));
  return {
    grade,
    label: PROPENSITY_LABEL[grade],
    returnMismatch: returnScore != null && returnScore - grade >= 2,
  };
}
