// 정성 요인(세금·유동성·법적·고유) "태그 + 강도" 채점 — rrttllu_scoring.py 표를 TS로 이식.
// 철학: 깊은 분석·절세 플랜이 아니라 "어떤 요인이 있고(태그) 얼마나 센지(강도 1~5)"만.
// 점수는 LLM 없이 규칙으로 산출 → 빠르고 일관·무료. portfolio.ts는 점수 1~5만 받으므로 호환.

import type { FactorKey } from "./types";

export interface FactorTag {
  id: string;
  label: string;
  score: number; // 1~5 강도(=severity/floor)
  kw?: string[]; // 자유서술/녹취에서 이 키워드가 보이면 해당 태그로 인식(라벨 정확매칭 보완)
}

// 세금: 한계세율 + 종합과세 + 시나리오 태그. 강도(=severity/floor)의 최대값을 점수로.
export const TAX_TAGS: FactorTag[] = [
  { id: "level_low", label: "한계세율 낮음(~24%)", score: 2, kw: ["저세율", "낮은 세율"] },
  { id: "level_mid", label: "한계세율 중간(24~38%)", score: 3, kw: ["중간 세율"] },
  { id: "level_high", label: "한계세율 높음(38%+)", score: 5, kw: ["고세율", "최고세율", "높은 세율", "38%", "42%", "45%"] },
  { id: "fin_income", label: "금융소득종합과세 대상", score: 4, kw: ["금융소득종합과세", "종합과세", "금소세", "금융소득"] },
  { id: "philanthropy", label: "공익·기부", score: 2, kw: ["공익", "기부", "출연"] },
  { id: "gift", label: "증여", score: 3, kw: ["증여"] },
  { id: "divorce", label: "이혼(재산분할)", score: 3, kw: ["이혼", "재산분할"] },
  { id: "real_estate", label: "부동산(양도·종부세)", score: 3, kw: ["부동산", "양도세", "종부세", "종합부동산"] },
  { id: "retirement", label: "은퇴·연금", score: 3, kw: ["은퇴", "연금", "퇴직"] },
  { id: "inheritance", label: "상속", score: 4, kw: ["상속"] },
  { id: "corporate", label: "법인(법인세·배당·승계)", score: 4, kw: ["법인세", "법인 ", "배당", "가업", "승계"] },
  { id: "offshore", label: "해외·비거주", score: 4, kw: ["해외주식", "해외 양도", "비거주", "국외", "역외"] },
];

// 유동성: 자금 필요 시점(급할수록 강도↑).
export const LIQUIDITY_TAGS: FactorTag[] = [
  { id: "long", label: "장기간 묶어둘 수 있음", score: 1, kw: ["장기간", "묶어둘", "유동성 필요 없"] },
  { id: "some_years", label: "수년 내 일부 필요", score: 2, kw: ["수년 내", "수년내"] },
  { id: "3to5y", label: "3~5년 내 목돈 필요", score: 3, kw: ["3~5년", "3년 이상", "3년 정도"] },
  { id: "1to2y", label: "1~2년 내 목돈 필요", score: 4, kw: ["1~2년", "1년 내", "2년 내", "내년", "내후년"] },
  { id: "anytime", label: "상시 인출 필요", score: 5, kw: ["상시", "수시", "언제든", "즉시 인출", "단기 현금화", "현금화 일정"] },
];

// 법적/규제
export const LEGAL_TAGS: FactorTag[] = [
  { id: "none", label: "제약 없음", score: 1 },
  { id: "corporate", label: "법인 자금", score: 3, kw: ["법인 자금", "법인자금", "법인 운용", "법인 운영자금"] },
  { id: "trust", label: "신탁", score: 3, kw: ["신탁"] },
  { id: "insider", label: "임원·최대주주", score: 4, kw: ["임원", "최대주주", "대주주", "보호예수", "내부자"] },
  { id: "guardianship", label: "성년후견", score: 4, kw: ["후견", "성년후견"] },
  { id: "foundation", label: "공익재단", score: 5, kw: ["공익재단", "재단"] },
];

// 고유 상황
export const UNIQUE_TAGS: FactorTag[] = [
  { id: "none", label: "특이사항 없음", score: 1 },
  { id: "specific_asset", label: "특정자산 보유의향", score: 2, kw: ["특정 종목", "특정 자산", "보유 의향", "보유의향"] },
  { id: "esg", label: "ESG·종교 제약", score: 3, kw: ["ESG", "종교", "윤리"] },
  { id: "family_gov", label: "가족 거버넌스", score: 3, kw: ["가족", "거버넌스", "가업승계", "승계"] },
  { id: "concentrated", label: "집중 포지션", score: 5, kw: ["집중", "단일 종목", "쏠림", "M&A", "지분 매각", "IPO", "보호예수"] },
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

// ── 부정문 처리 ─────────────────────────────────────────────────────────────
// 단순 부분매칭만 하면 "상속 계획 없습니다"가 상속 태그로 잡혀 explicit + 4점이 된다.
// 한국어는 서술어가 뒤에 오므로 부정어는 거의 항상 키워드 "뒤"에 붙는다 — 키워드 바로
// 뒤 짧은 구간만 본다. 앞쪽은 보지 않는다(창을 넓힐수록 미탐이 는다).
//
// 창을 14자로 둔 이유: "상속·증여 관련 논의 불필요"(13자)까지는 닿고,
// "증여 관련해서는 특별히 논의된 바 없습니다"(17자)처럼 멀어지면 놓친다. 더 넓히면
// 뒷문장의 부정어까지 끌어와 멀쩡한 태그를 떨어뜨린다 — 태그를 놓치는 쪽(미탐)이
// 없는 태그를 만드는 쪽(오탐)보다 위험하므로 보수적으로 좁게 잡았다.
const NEGATION_WINDOW = 14;
const NEGATION_ADVERB_WINDOW = 6;

// 어간 형태로 적는다. "아니"만 넣으면 "아닙니다"("아니"를 포함하지 않는다)를 놓친다.
// 부사 "안"은 여기 넣지 않는다 — "방안·대안·제안"의 끝글자와 구별되지 않는다.
// 대신 STANDALONE_NEGATION 정규식으로 앞에 공백·문장부호가 오는 경우만 잡는다.
const NEGATION_MARKERS = [
  "없", "않", "아니", "아닙", "아님", "아냐",
  "불필", "무관", "미해당",
  "못하", "못한", "못함",
];

// 앞이 공백·구두점(또는 키워드 직후)인 "안" 만 부정 부사로 본다.
//   "신탁은 안 합니다" → 부정        "절세 방안 검토" → 부정 아님
// 부사 "안"은 뒤따르는 용언 하나만 부정한다. 창을 넓게 두면 뒷절의 "안 좋아지면"
// 같은 표현이 앞 키워드를 부정하는 것으로 잡힌다 — 실제로 한서홀딩스 메모의
// "집중 포지션 자회사 실적 안좋아지면…"에서 집중 포지션(5점) 태그가 통째로
// 사라졌다. 그래서 조사 하나 정도(6자)만 본다.
const STANDALONE_NEGATION = /(^|[\s,.·「」"'()\[\]])안\s?[가-힣]/;

// 부정어가 보여도 부정이 아닌 경우.
const NEGATION_EXCEPTIONS = [
  // 이중부정은 다시 긍정이다("상속세 부담이 없지 않다").
  "없지 않", "없지는 않", "않지 않", "아니지 않", "없는 것은 아니", "없다고 볼 수 없",
  // 인과 연결("상속 계획이 없어서 지금부터 세워야 한다")은 화제가 살아 있다는 뜻이다.
  // 여기서 태그를 떨어뜨리면 상담이 필요한 고객을 놓친다.
  "없어서", "없으니", "없기 때문", "없다 보니", "없다보니",
];

function isNegatedAfter(lower: string, start: number, len: number): boolean {
  const window = lower.slice(start + len, start + len + NEGATION_WINDOW);
  if (NEGATION_EXCEPTIONS.some((m) => window.includes(m))) return false;
  if (NEGATION_MARKERS.some((m) => window.includes(m))) return true;
  return STANDALONE_NEGATION.test(window.slice(0, NEGATION_ADVERB_WINDOW));
}

/**
 * 부정되지 않은 언급이 하나라도 있으면 true.
 * 같은 키워드가 여러 번 나오면 전부 부정된 경우에만 태그를 떨어뜨린다 —
 * "상속 계획은 없지만 상속세 상담은 필요"처럼 한 번이라도 살아 있으면 태그를 남긴다.
 */
function hasUnnegated(lower: string, needle: string): boolean {
  const n = needle.toLowerCase();
  if (!n) return false;
  for (let i = lower.indexOf(n); i !== -1; i = lower.indexOf(n, i + n.length)) {
    if (!isNegatedAfter(lower, i, n.length)) return true;
  }
  return false;
}

// 텍스트(LLM 출력/원문)에서 해당 요인 태그 추출 — 라벨 정확매칭 + 키워드 부분매칭.
// AI가 "부동산 양도세, 증여세"처럼 풀어 써도 키워드로 태그를 잡아 점수가 매겨지게 한다.
// 키워드 뒤에 부정어가 붙은 언급은 제외한다(위 부정문 처리 참고).
export function matchTagsInText(key: FactorKey, text: string): { labels: string[]; score: number | null } {
  const tags = TAG_FACTORS[key];
  if (!tags || !text) return { labels: [], score: null };
  const lower = text.toLowerCase();
  const labels = tags
    .filter((t) => hasUnnegated(lower, t.label) || (t.kw ?? []).some((k) => hasUnnegated(lower, k)))
    .map((t) => t.label);
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
