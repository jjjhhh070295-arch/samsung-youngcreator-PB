// ★팀원 구현 영역 — 포트폴리오 생성 (현재는 더미 스캐폴드)
//
// 화면·타입·저장·PB 수정 UI는 동작하게 만들어 두고,
// 숫자 산출 로직만 더미로 비워둔다. 팀원이 이 함수 본문만 교체하면 실동작한다.

import type { Client, Portfolio, AssetAllocation } from "./types";

function alloc(assetClass: string, weight: number): AssetAllocation {
  return { assetClass, weight };
}

function uid(prefix: string): string {
  return prefix + "-" + Math.random().toString(36).slice(2, 8);
}

// 위험 허용도 점수(risk.score, 1~5)에 따라 주식 비중만 대충 조정하는 단순 규칙.
// TODO(팀원): RRTTLLU·현금흐름·세금을 반영한 실제 최적화 로직으로 교체.
export function generatePortfolios(client: Client): Portfolio[] {
  const riskScore = client.ips?.risk?.score ?? 3; // 근거 없으면 중립 가정(더미)
  const equityBias = Math.max(0, Math.min(4, riskScore - 1)); // 0~4

  // 3개 후보: 안정형 / 균형형 / 성장형
  const stable: Portfolio = {
    id: uid("pf"),
    label: "안정형",
    allocations: [
      alloc("국내주식", 10),
      alloc("해외주식", 10),
      alloc("채권", 50),
      alloc("대체투자", 10),
      alloc("현금", 20),
    ],
    expectedReturn: 4.0,
    expectedRisk: 5.0,
    taxNote: "TODO(팀원): 세금(금소세·법인세 등) 반영한 메모로 교체. (더미)",
    rationale:
      "TODO(팀원): 실제 최적화 근거로 교체. (더미) 원금 보전 중시, 채권·현금 비중 높음.",
    editedByPb: false,
  };

  const balanced: Portfolio = {
    id: uid("pf"),
    label: "균형형",
    allocations: [
      alloc("국내주식", 20 + equityBias),
      alloc("해외주식", 20 + equityBias),
      alloc("채권", 35 - equityBias),
      alloc("대체투자", 15),
      alloc("현금", 10 - equityBias),
    ],
    expectedReturn: 6.0,
    expectedRisk: 9.0,
    taxNote: "TODO(팀원): 세금 메모. (더미)",
    rationale:
      "TODO(팀원): 실제 근거로 교체. (더미) 위험점수에 따라 주식 비중 가변.",
    editedByPb: false,
  };

  const growth: Portfolio = {
    id: uid("pf"),
    label: "성장형",
    allocations: [
      alloc("국내주식", 30 + equityBias),
      alloc("해외주식", 35 + equityBias),
      alloc("채권", 15 - equityBias),
      alloc("대체투자", 15),
      alloc("현금", 5 - equityBias),
    ],
    expectedReturn: 8.5,
    expectedRisk: 14.0,
    taxNote: "TODO(팀원): 세금 메모. (더미)",
    rationale:
      "TODO(팀원): 실제 근거로 교체. (더미) 장기·고위험 감내 시 후보.",
    editedByPb: false,
  };

  // 비중 합 100 보정 (더미값이 음수/초과되지 않도록)
  return [stable, balanced, growth].map(normalizeWeights);
}

// 비중 합계를 100으로 맞춘다 (PB 수정 검증에도 재사용).
export function normalizeWeights(p: Portfolio): Portfolio {
  const clamped = p.allocations.map((a) => ({
    ...a,
    weight: Math.max(0, a.weight),
  }));
  const sum = clamped.reduce((s, a) => s + a.weight, 0) || 1;
  return {
    ...p,
    allocations: clamped.map((a) => ({
      ...a,
      weight: Math.round((a.weight / sum) * 1000) / 10,
    })),
  };
}

export function weightSum(p: Portfolio): number {
  return Math.round(p.allocations.reduce((s, a) => s + a.weight, 0) * 10) / 10;
}
