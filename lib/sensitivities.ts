// ──────────────────────────────────────────────────────────────────────────
//  자산군 × 매크로 요인 민감도 (백테스트 추정 계수)
// ──────────────────────────────────────────────────────────────────────────
//
//  추정 방법:
//    최근 ~10년 월간 데이터(2015-07 ~ 2024-05, n=86)에 대해
//    각 자산군 월간 총수익률(%)을 5개 매크로 요인에 다중회귀(OLS).
//
//  데이터 출처(프록시):
//    · 국내주식  ← KOSPI (^KS11)                      [Yahoo Finance]
//    · 미국주식  ← S&P 500 (^GSPC)                    [Yahoo Finance]
//    · 채권      ← 미국 10년 국채 가격 민감도 프록시   [Yahoo/FRED]
//    · 기준금리  ← FEDFUNDS                           [FRED]
//    · 10년물    ← US 10Y Treasury Yield (^TNX)       [Yahoo/FRED]
//    · 인플레    ← US CPI (CPIAUCSL) 월간 변화율       [FRED]
//    · 환율      ← USD/KRW (KRW=X)                    [Yahoo Finance]
//    · 원자재    ← iShares S&P GSCI (GSG)             [Yahoo Finance]
//
//  계수(beta) 해석: 해당 요인 1단위 충격당 자산군 월수익률 반응(%).
//    · d_fed, d_ust : 1단위 = +1.0%p
//    · infl         : 1단위 = +1.0% (월간 물가 상승)
//    · ret_krw      : 1단위 = +1.0% (원화 약세)
//    · ret_cmd      : 1단위 = +1.0% (원자재 상승)
//
//  ⚠ 참고용 통계 추정치 — 미래를 보장하지 않으며 PB 판단의 보조 지표.
//    t-통계량 |t|>1.96 이면 5% 유의(아래 sig 표기). R²는 모델 설명력.
//
//  재현: /bt/analyze.py (회귀 스크립트) → /bt/sensitivities.json

import type { MacroFactorId, MacroFactorMeta } from "./types";

export interface AssetSensitivity {
  key: string; // 내부 키
  label: string; // 자산군 라벨 (포트폴리오 allocations.assetClass 와 매칭)
  betas: Record<MacroFactorId, number>; // 요인별 민감도 계수 (%/단위)
  tvals: Record<MacroFactorId, number>; // 계수 t-통계량 (신뢰도)
  r2: number; // 모델 설명력 0~1
  monthlyVol: number; // 표본 월간 변동성(%) — 낙폭 추정에 사용
}

export const SAMPLE_INFO = {
  start: "2015-07",
  end: "2024-05",
  n: 86,
  note: "최근 약 10년 월간 데이터 다중회귀 추정치 (참고용·PB 검토 전제)",
};

// 요인 슬라이더 메타 — 범위는 과거 관측치 + 정책적 스트레스 폭을 고려해 설정.
export const FACTOR_META: MacroFactorMeta[] = [
  {
    id: "d_fed",
    label: "미국 기준금리",
    labelEn: "Fed Funds",
    unit: "%p",
    min: -2,
    max: 2,
    step: 0.25,
    hint: "연준 기준금리 변화(%p). +는 인상. 위험자산·금리민감 자산에 부정적.",
  },
  {
    id: "d_ust",
    label: "미국 10년물 금리",
    labelEn: "UST 10Y",
    unit: "%p",
    min: -2,
    max: 2,
    step: 0.1,
    hint: "10년물 시장금리 변화(%p). 채권 듀레이션·금 가격에 직접 영향(가장 강건).",
  },
  {
    id: "infl",
    label: "인플레이션",
    labelEn: "CPI",
    unit: "%",
    min: -1,
    max: 2,
    step: 0.1,
    hint: "월간 물가 상승률(%). 채권 실질가치·금리경로에 영향.",
  },
  {
    id: "ret_krw",
    label: "원달러 환율",
    labelEn: "USD/KRW",
    unit: "%",
    min: -15,
    max: 15,
    step: 1,
    hint: "원/달러 변동(%). +는 원화 약세 → 외국인 자금 유출로 국내주식에 부정적.",
  },
  {
    id: "ret_cmd",
    label: "원자재 물가",
    labelEn: "Commodity",
    unit: "%",
    min: -30,
    max: 30,
    step: 1,
    hint: "원자재 가격 변동(%). 원자재·실물 연계 자산과 동조.",
  },
];

// 백테스트 추정 계수 (bt/sensitivities.json 과 동기화)
export const ASSET_SENSITIVITIES: AssetSensitivity[] = [
  {
    key: "kospi",
    label: "국내주식 (KOSPI)",
    betas: { d_fed: -6.9747, d_ust: 0.2034, infl: 0.935, ret_krw: -0.3929, ret_cmd: -0.0597 },
    tvals: { d_fed: -2.22, d_ust: 0.1, infl: 0.51, ret_krw: -2.09, ret_cmd: -0.65 },
    r2: 0.106,
    monthlyVol: 4.578,
  },
  {
    key: "spx",
    label: "미국주식 (S&P 500)",
    betas: { d_fed: -4.2883, d_ust: -4.5043, infl: -2.1917, ret_krw: -0.0693, ret_cmd: 0.2898 },
    tvals: { d_fed: -1.49, d_ust: -2.35, infl: -1.31, ret_krw: -0.4, ret_cmd: 3.45 },
    r2: 0.206,
    monthlyVol: 4.436,
  },
  {
    key: "bond",
    label: "채권 (미국채 10년물)",
    betas: { d_fed: 0.0239, d_ust: -6.0265, infl: -0.5304, ret_krw: -0.0372, ret_cmd: 0.0367 },
    tvals: { d_fed: 0.08, d_ust: -28.9, infl: -2.9, ret_krw: -1.99, ret_cmd: 4.01 },
    r2: 0.927,
    monthlyVol: 1.593,
  },
];

// 포트폴리오 자산군 라벨 → 민감도 매핑 (부분 문자열 매칭 허용)
export function findSensitivity(assetClass: string): AssetSensitivity {
  const direct = ASSET_SENSITIVITIES.find((s) => s.label === assetClass);
  if (direct) return direct;
  // 느슨한 매칭 (예: "국내 주식", "해외주식(ETF)" 등)
  const a = assetClass.replace(/\s/g, "");
  if ((a.includes("국내") && a.includes("주식")) || a.includes("kospi")) return byKey("kospi");
  if ((a.includes("미국") && a.includes("주식")) || a.includes("해외주식") || a.includes("s&p500")) return byKey("spx");
  if (a.includes("채권") || a.includes("미국채10년")) return byKey("bond");
  throw new Error(`지원하지 않는 매크로 스트레스 자산군: ${assetClass}`);
}

function byKey(key: string): AssetSensitivity {
  return ASSET_SENSITIVITIES.find((s) => s.key === key)!;
}
