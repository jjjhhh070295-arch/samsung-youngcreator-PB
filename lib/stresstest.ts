// ──────────────────────────────────────────────────────────────────────────
//  스트레스 테스트 — 데이터 기반 매크로 요인 민감도 모델
// ──────────────────────────────────────────────────────────────────────────
//
//  사용자가 5개 매크로 요인(미국 기준금리·10년물·인플레·원달러·원자재)을 강도
//  슬라이더로 조정하면, 자산군별 회귀 추정 민감도(베타)로 충격을 전이해
//  포트폴리오의 시나리오 예상수익·예상낙폭·자산군별 기여도·충격 후 비중변화·
//  스트레스 대응 조정 포트폴리오를 산출한다.
//
//  민감도 계수: lib/sensitivities.ts (최근 ~10년 월간 데이터 다중회귀).
//  ⚠ 참고용 통계 추정 — 투자권유 아님. PB 검토 전제.

import type {
  Portfolio,
  ScenarioShock,
  MacroFactorId,
  StressTestResult,
  AssetContribution,
  WeightShift,
  RebalanceProposal,
  AssetAllocation,
} from "./types";
import {
  ASSET_SENSITIVITIES,
  FACTOR_META,
  findSensitivity,
  SAMPLE_INFO,
} from "./sensitivities";

export { FACTOR_META, SAMPLE_INFO, ASSET_SENSITIVITIES };

export const FACTOR_IDS: MacroFactorId[] = FACTOR_META.map((f) => f.id);

// 충격 0 (기본 슬라이더 초기값)
export function zeroShock(): ScenarioShock {
  return { d_fed: 0, d_ust: 0, infl: 0, ret_krw: 0, ret_cmd: 0 };
}

// 사전 정의 프리셋 시나리오 (슬라이더 빠른 설정용)
export const PRESET_SCENARIOS: { id: string; name: string; shock: ScenarioShock }[] = [
  { id: "none", name: "충격 없음", shock: zeroShock() },
  {
    id: "rate_up",
    name: "금리 급등 (Fed +1%p · UST +1%p)",
    shock: { ...zeroShock(), d_fed: 1, d_ust: 1 },
  },
  {
    id: "stagflation",
    name: "스태그플레이션 (인플레↑ · 원자재↑ · UST↑)",
    shock: { ...zeroShock(), infl: 1, ret_cmd: 15, d_ust: 0.8 },
  },
  {
    id: "krw_weak",
    name: "원화 급락 (USD/KRW +10%)",
    shock: { ...zeroShock(), ret_krw: 10 },
  },
  {
    id: "easing",
    name: "금리 인하 (Fed -1%p · UST -1%p)",
    shock: { ...zeroShock(), d_fed: -1, d_ust: -1 },
  },
  {
    id: "risk_off",
    name: "위험회피 복합 (금리↑·원화↓·원자재↓)",
    shock: { ...zeroShock(), d_ust: 1, ret_krw: 8, ret_cmd: -15 },
  },
];

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;

// 자산군 1개의 시나리오 충격 수익(%) + 요인별 분해
function assetShockReturn(assetClass: string, shock: ScenarioShock) {
  const sens = findSensitivity(assetClass);
  const byFactor = {} as Record<MacroFactorId, number>;
  let total = 0;
  for (const id of FACTOR_IDS) {
    const eff = sens.betas[id] * shock[id]; // 충격분(상수항 제외 = 순수 요인 영향)
    byFactor[id] = r2(eff);
    total += eff;
  }
  return { sens, byFactor, total: r2(total) };
}

// 메인: 포트폴리오별 스트레스 결과 산출
export function runStressTest(
  portfolios: Portfolio[],
  shock: ScenarioShock,
): StressTestResult[] {
  return portfolios.map((p) => {
    const contributions: AssetContribution[] = [];
    const weightShifts: WeightShift[] = [];

    let shockImpact = 0; // 요인 충격분 포트폴리오 수익 영향(%)
    let r2Weighted = 0; // 신뢰도 가중합
    let weightSum = 0;
    let varianceShare = 0; // 충격 후 분산 근사(낙폭 버퍼용)

    // 충격 후 가치 드리프트 계산용
    const driftedValues: { assetClass: string; before: number; value: number }[] = [];

    for (const a of p.allocations) {
      const { sens, byFactor, total } = assetShockReturn(a.assetClass, shock);
      const w = a.weight; // %
      const contribution = (w / 100) * total; // 포트폴리오 수익 기여(%)
      shockImpact += contribution;
      r2Weighted += (w / 100) * sens.r2;
      weightSum += w / 100;
      // 자산군 변동성 가중 (단순 독립 가정 근사)
      varianceShare += Math.pow((w / 100) * sens.monthlyVol, 2);

      contributions.push({
        assetClass: a.assetClass,
        weight: r1(w),
        assetReturn: total,
        contribution: r2(contribution),
        byFactor,
      });

      // 가치 드리프트: 충격 후 1+r 배 (비중 변화 산출)
      driftedValues.push({ assetClass: a.assetClass, before: w, value: w * (1 + total / 100) });
    }

    // 충격 후 비중 정규화
    const driftTotal = driftedValues.reduce((s, d) => s + d.value, 0) || 1;
    for (const d of driftedValues) {
      const after = (d.value / driftTotal) * 100;
      weightShifts.push({
        assetClass: d.assetClass,
        before: r1(d.before),
        after: r1(after),
        delta: r1(after - d.before),
      });
    }

    const baseReturn = p.expectedReturn; // 연 기대수익(%) — 충격 전
    // 시나리오 충격은 "월간 충격 1회" 기준 → 연환산 영향으로 보정(×1, 1회성 쇼크로 해석)
    const projectedReturn = r1(baseReturn + shockImpact);

    // 예상 낙폭: 요인 충격 손실 + 2σ tail 버퍼 (포트폴리오 월변동성 근사)
    const portVol = Math.sqrt(varianceShare); // 월간 %
    const tailBuffer = 2 * portVol; // 2σ
    const projectedDrawdown = r1(Math.max(0, -shockImpact) + tailBuffer);

    const confidence = weightSum > 0 ? r2(r2Weighted / weightSum) : 0;

    return {
      portfolioId: p.id,
      label: p.label,
      baseReturn: r1(baseReturn),
      projectedReturn,
      projectedDrawdown,
      shockImpact: r2(shockImpact),
      contributions,
      weightShifts,
      confidence,
      note:
        shockImpact >= 0
          ? "요인 충격이 포트폴리오에 우호적 (가격 상승 압력)."
          : "요인 충격이 포트폴리오 수익을 압박. 방어자산 비중 점검 권장.",
    };
  });
}

// ── 스트레스 대응 조정 포트폴리오 제안 ──
//
//  로직: 시나리오에서 손실 기여가 큰 자산군의 비중을 줄이고, 같은 시나리오에서
//  상대적으로 강건(충격 수익이 높은)한 자산군 + 현금으로 이전한다.
//  최대 이전폭은 자산군당 ±maxShift%p 로 제한해 과도한 리밸런싱을 방지.
export function proposeRebalance(
  portfolio: Portfolio,
  shock: ScenarioShock,
  maxShift = 10,
): RebalanceProposal {
  // 자산군별 충격 수익
  const scored = portfolio.allocations.map((a) => ({
    assetClass: a.assetClass,
    weight: a.weight,
    ret: assetShockReturn(a.assetClass, shock).total,
  }));

  // 충격이 0이면 조정 없음
  const anyShock = FACTOR_IDS.some((id) => shock[id] !== 0);
  if (!anyShock) {
    const base = runStressTest([portfolio], shock)[0];
    return {
      basePortfolioId: portfolio.id,
      label: "스트레스 대응 조정안",
      allocations: portfolio.allocations.map((a) => ({ ...a })),
      rationale: "충격이 설정되지 않아 조정이 필요하지 않습니다.",
      projectedReturn: base.projectedReturn,
      projectedDrawdown: base.projectedDrawdown,
      improvementDrawdown: 0,
    };
  }

  const avgRet = scored.reduce((s, x) => s + x.ret, 0) / (scored.length || 1);
  // 평균보다 약한 자산군에서 비중 차감, 강한 자산군으로 이전
  const weak = scored.filter((x) => x.ret < avgRet);
  const strong = scored.filter((x) => x.ret >= avgRet);

  // 차감 가능 총량
  const newWeights = new Map<string, number>(scored.map((x) => [x.assetClass, x.weight]));
  let pool = 0;
  for (const x of weak) {
    const cut = Math.min(maxShift, x.weight * 0.5); // 최대 비중의 절반 또는 maxShift
    newWeights.set(x.assetClass, x.weight - cut);
    pool += cut;
  }
  // 강건 자산군 가중치(충격 수익 상대강도)로 풀 배분
  const strongScores = strong.map((x) => ({ ...x, s: x.ret - avgRet + 0.01 }));
  const sSum = strongScores.reduce((s, x) => s + Math.max(0, x.s), 0) || 1;
  for (const x of strongScores) {
    const add = pool * (Math.max(0, x.s) / sSum);
    newWeights.set(x.assetClass, (newWeights.get(x.assetClass) ?? 0) + add);
  }

  const adjAllocations: AssetAllocation[] = portfolio.allocations.map((a) => ({
    assetClass: a.assetClass,
    weight: Math.round((newWeights.get(a.assetClass) ?? a.weight) * 10) / 10,
  }));

  // 조정안 평가
  const adjPortfolio: Portfolio = { ...portfolio, allocations: adjAllocations };
  const baseRes = runStressTest([portfolio], shock)[0];
  const adjRes = runStressTest([adjPortfolio], shock)[0];

  const reduced = weak
    .filter((x) => x.ret < avgRet)
    .map((x) => x.assetClass)
    .join(", ");
  const increased = strongScores
    .filter((x) => x.s > 0.01)
    .map((x) => x.assetClass)
    .join(", ");

  return {
    basePortfolioId: portfolio.id,
    label: "스트레스 대응 조정안",
    allocations: adjAllocations,
    rationale:
      `이 시나리오에서 상대적으로 취약한 ${reduced || "위험자산"} 비중을 축소하고, ` +
      `충격에 강건한 ${increased || "방어자산"} 비중을 확대했습니다. ` +
      `(자산군당 최대 ${maxShift}%p 이내 조정)`,
    projectedReturn: adjRes.projectedReturn,
    projectedDrawdown: adjRes.projectedDrawdown,
    improvementDrawdown: r1(baseRes.projectedDrawdown - adjRes.projectedDrawdown),
  };
}
