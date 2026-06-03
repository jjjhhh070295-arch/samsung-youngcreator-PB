// ★팀원 구현 영역 — 스트레스 테스트 (현재는 더미 스캐폴드)
//
// 시나리오 목록·실행 UI·결과 표시는 동작하게 만들어 두고,
// 검정 로직만 더미로 비워둔다. 팀원이 runStressTest 본문만 교체하면 실동작.

import type { Portfolio, StressScenario, StressTestResult } from "./types";

// 기본 시나리오 목록 (더미). TODO(팀원): 실제 시나리오·파라미터로 확장.
export const DEFAULT_SCENARIOS: StressScenario[] = [
  { id: "rate_up", name: "금리 +2%p", params: { rateDelta: 0.02 } },
  { id: "equity_down", name: "주식 -30%", params: { equityShock: -0.3 } },
  { id: "inflation", name: "인플레 급등", params: { inflation: 0.05 } },
  { id: "fx_shock", name: "환율 +15%", params: { fx: 0.15 } },
];

// 후보별·시나리오별 더미 결과 산출.
// TODO(팀원): 실제 시나리오 모델(요인 민감도, 자산별 충격 전이 등) 적용.
export function runStressTest(
  portfolios: Portfolio[],
  scenario: StressScenario,
): StressTestResult[] {
  return portfolios.map((p) => {
    // 더미: 주식 비중이 높을수록 충격에 더 민감하다고 가정.
    const equity =
      p.allocations
        .filter((a) => a.assetClass.includes("주식"))
        .reduce((s, a) => s + a.weight, 0) / 100;

    const shock = Math.abs(
      Object.values(scenario.params)[0] ?? 0.1,
    );
    const projectedDrawdown = Math.round(equity * shock * 100 * 1.5 * 10) / 10; // 더미
    const projectedReturn =
      Math.round((p.expectedReturn - projectedDrawdown * 0.4) * 10) / 10; // 더미

    return {
      portfolioId: p.id,
      scenarioId: scenario.id,
      projectedReturn,
      projectedDrawdown,
      note: "더미 결과 — TODO(팀원): 실제 검정 로직으로 교체.",
    };
  });
}
