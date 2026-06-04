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
