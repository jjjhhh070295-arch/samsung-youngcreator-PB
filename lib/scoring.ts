// RRTTLLU 7요인 점수(1~5) 고정 기준표
// "높을수록 그 요인의 수준이 큼" 원칙. AI 분석 프롬프트 + PB 입력 폼 안내에 공통 사용.
// ※ 숫자 컷오프는 프로토타입 기준값이며, 운용 정책에 맞게 조정 가능.

import type { FactorKey } from "./types";

// 각 요인별 1~5점 기준 (index 0 = 1점 … index 4 = 5점)
export const SCORE_RUBRIC: Record<FactorKey, string[]> = {
  return: [
    "연 목표수익률 3% 이하 또는 예금·단기채 수준의 수익만 요구",
    "연 3% 초과~5% 이하, 안정적 인컴을 주된 목표로 함",
    "연 5% 초과~7% 이하, 시장 평균 수준의 총수익을 목표로 함",
    "연 7% 초과~10% 이하, 성장자산 비중 확대가 필요한 목표",
    "연 10% 초과 또는 벤치마크 초과수익·고수익을 명시적으로 요구",
  ],
  risk: [
    "감내 가능한 평가손실 5% 이하, 원금보전 또는 손실 회피가 최우선",
    "감내 손실 5% 초과~10% 이하, 낮은 변동성 선호",
    "감내 손실 10% 초과~15% 이하, 중위험 분산 포트폴리오 허용",
    "감내 손실 15% 초과~25% 이하, 주식·테마 변동성 상당 부분 허용",
    "감내 손실 25% 초과 또는 고위험·공격형 운용을 명시적으로 허용",
  ],
  timeHorizon: [
    "투자 가능 기간 1년 미만, 현금화 일정이 매우 가까움",
    "1년 이상~3년 이하, 단기 목표자금이 우선",
    "3년 초과~5년 이하, 중기 운용 가능",
    "5년 초과~10년 이하, 장기 운용으로 변동성 흡수 가능",
    "10년 초과 또는 은퇴·승계 등 초장기 목적자금",
  ],
  tax: [
    "과세 이벤트가 없거나 비과세·저율 계좌 중심, 한계세율 15% 이하",
    "과세 영향이 작음, 한계세율 15% 초과~24% 이하 또는 소액 이자·배당",
    "일반 과세 고려 필요, 한계세율 24% 초과~38% 이하 또는 반복 과세소득 존재",
    "금융소득종합과세 근접·대상, 증여·양도·법인세 등 예정 세금 이벤트 존재",
    "최고세율권·대규모 증여/상속/양도/법인세 또는 절세 최우선 요구",
  ],
  liquidity: [
    "1년 내 필요자금이 AUM의 5% 이하, 장기간 묶어둘 수 있음",
    "1~3년 내 필요자금이 AUM의 5% 초과~10% 이하",
    "3~5년 내 목돈 필요 또는 필요자금이 AUM의 10% 초과~20% 이하",
    "1~2년 내 목돈 필요 또는 필요자금이 AUM의 20% 초과~35% 이하",
    "상시 인출·세금 납부·M&A/IPO 등 단기 현금화 필요가 AUM의 35% 초과",
  ],
  legal: [
    "법적·규제·계약상 제약 없음",
    "투자 제외 선호 등 경미한 내부 제한만 존재",
    "계좌/상품 한도, 법인 자금 운용규정 등 일반 제약 존재",
    "임원·최대주주·보호예수·신탁 등 매매/운용에 뚜렷한 제약 존재",
    "후견·공익재단·이사회 승인·소송/담보 등 포트폴리오 구조를 좌우하는 제약",
  ],
  unique: [
    "특이사항 없음",
    "선호 상품·관심 테마 등 경미한 고려사항",
    "ESG/종교/가족 거버넌스/상품 제외 등 일부 비중 조정 필요",
    "특정 자산 집중, 승계·사업자금 등 운용에 뚜렷한 영향",
    "단일종목/비상장지분/IPO·M&A·보호예수 등 전체 배분을 크게 좌우",
  ],
};

// 입력값에서 점수를 자동 산출할 수 있는 "정량 요인" (숫자 → 기준표 구간)
// 나머지(tax/liquidity/legal/unique)는 정성 → 자동 채점 대신 확정 시 LLM 판단.
export const QUANT_FACTORS: FactorKey[] = ["return", "risk", "timeHorizon"];

// 정량 요인: 입력값 문자열에서 숫자를 뽑아 기준표 구간 → 1~5점 자동 산출.
// 범위("6~8%")는 중간값, "이상/초과/+"는 상단·"미만/이하"는 하단으로 보정. 숫자 없으면 null.
// 숫자가 없을 때 정성적 표현으로 점수 추정 (자유서술 채점용). 매칭 없으면 null.
function qualScore(key: FactorKey, value: string): number | null {
  const v = (value || "").toLowerCase();
  const bands: Record<string, [RegExp, number][]> = {
    return: [
      [/공격|고수익|두자리|매우 높|10\s*%\s*이상/, 5],
      [/성장|적극|높은 수익|중상/, 4],
      [/중간|일반|보통/, 3],
      [/안정|보수|예금|원금|낮/, 2],
    ],
    risk: [
      [/공격|고위험|적극|크게 감수|손실 감수|매우 높/, 5],
      [/중상|다소 공격|약간 공격/, 4],
      [/중위험|중립|균형|보통/, 3],
      [/안정|보수|원금\s*보전|손실\s*싫|낮/, 1],
    ],
    timeHorizon: [
      [/초장기|장기|10\s*년|평생|은퇴 후/, 5],
      [/5\s*년 이상|7\s*년|중장기/, 4],
      [/중기|3\s*[~-]\s*5|3\s*년/, 3],
      [/단기|1\s*[~-]\s*3|1\s*년/, 2],
      [/초단기|수개월|6\s*개월|1\s*년\s*미만/, 1],
    ],
  };
  for (const [re, s] of bands[key] ?? []) if (re.test(v)) return s;
  return null;
}

export function autoScoreFromValue(key: FactorKey, value: string): number | null {
  if (!QUANT_FACTORS.includes(key)) return null;
  const raw = (value || "").match(/\d+(?:\.\d+)?/g);
  if (!raw || raw.length === 0) return qualScore(key, value); // 숫자 없으면 표현으로 추정
  const nums = raw.map(Number);
  let n = nums.length >= 2 ? (nums[0] + nums[1]) / 2 : nums[0];
  if (/이상|초과|넘|over|\+/i.test(value)) n *= 1.001; // 경계에서 상단 구간으로
  if (/미만|이하|under|less/i.test(value)) n *= 0.999; // 경계에서 하단 구간으로

  switch (key) {
    case "return": // 목표 수익률 %
      return n <= 3 ? 1 : n <= 5 ? 2 : n <= 7 ? 3 : n <= 10 ? 4 : 5;
    case "risk": // 감내 손실 %
      return n <= 5 ? 1 : n <= 10 ? 2 : n <= 15 ? 3 : n <= 25 ? 4 : 5;
    case "timeHorizon": {
      // "개월/달/month"만 있고 "년/year"가 없으면 월 → 년 환산
      if (/개월|달|month/i.test(value) && !/년|year/i.test(value)) n /= 12;
      return n < 1 ? 1 : n <= 3 ? 2 : n <= 5 ? 3 : n <= 10 ? 4 : 5;
    }
    default:
      return null;
  }
}

// AI 프롬프트용 기준표 텍스트
export function rubricForPrompt(): string {
  const lines: string[] = [];
  for (const key of Object.keys(SCORE_RUBRIC) as FactorKey[]) {
    const bands = SCORE_RUBRIC[key]
      .map((d, i) => `${i + 1}점=${d}`)
      .join(", ");
    lines.push(`- ${key}: ${bands}`);
  }
  return lines.join("\n");
}
