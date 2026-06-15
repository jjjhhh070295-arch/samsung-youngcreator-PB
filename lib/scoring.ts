// RRTTLLU 7요인 점수(1~5) 고정 기준표
// "높을수록 그 요인의 수준이 큼" 원칙. AI 분석 프롬프트 + PB 입력 폼 안내에 공통 사용.
// ※ 숫자 컷오프는 프로토타입 기준값이며, 운용 정책에 맞게 조정 가능.

import type { FactorKey } from "./types";

// 각 요인별 1~5점 기준 (index 0 = 1점 … index 4 = 5점)
export const SCORE_RUBRIC: Record<FactorKey, string[]> = {
  return: [
    "목표 수익률 ~3% (예금 수준)",
    "3~5%",
    "5~7%",
    "7~10%",
    "10% 이상 (고수익 추구)",
  ],
  risk: [
    "감내 손실 ~5% (원금보전 최우선)",
    "5~10%",
    "10~15%",
    "15~25%",
    "25% 이상 (공격적)",
  ],
  timeHorizon: [
    "1년 미만 (초단기)",
    "1~3년",
    "3~5년",
    "5~10년",
    "10년 이상 (초장기)",
  ],
  tax: [
    "세금 무관/비과세 중심",
    "세금 민감도 낮음",
    "일반 과세 고려",
    "금융소득종합과세 근접·대상",
    "고세율·적극적 절세 필요",
  ],
  liquidity: [
    "장기간 묶어둘 수 있음 (유동성 필요 거의 없음)",
    "수년 내 일부 필요",
    "3~5년 내 목돈 필요",
    "1~2년 내 목돈 필요",
    "상시 인출 필요 (유동성 필요 매우 큼)",
  ],
  legal: [
    "법적·규제 제약 없음",
    "경미한 제약",
    "일반적 제약 (분산·한도 등)",
    "뚜렷한 제약 (법인 규정·약관 등)",
    "강한 제약 (신탁·후견·이사회 한도 등)",
  ],
  unique: [
    "특이사항 없음",
    "경미한 고려사항",
    "일부 영향 (선호·제외 등)",
    "운용에 뚜렷한 영향",
    "운용을 크게 좌우하는 고유 상황",
  ],
};

// 입력값에서 점수를 자동 산출할 수 있는 "정량 요인" (숫자 → 기준표 구간)
// 나머지(tax/liquidity/legal/unique)는 정성 → 자동 채점 대신 확정 시 LLM 판단.
export const QUANT_FACTORS: FactorKey[] = ["return", "risk", "timeHorizon"];

// 정량 요인: 입력값 문자열에서 숫자를 뽑아 기준표 구간 → 1~5점 자동 산출.
// 범위("6~8%")는 중간값, "이상/초과/+"는 상단·"미만/이하"는 하단으로 보정. 숫자 없으면 null.
export function autoScoreFromValue(key: FactorKey, value: string): number | null {
  if (!QUANT_FACTORS.includes(key)) return null;
  const raw = (value || "").match(/\d+(?:\.\d+)?/g);
  if (!raw || raw.length === 0) return null;
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
