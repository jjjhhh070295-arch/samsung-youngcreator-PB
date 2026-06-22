/**
 * lib/holdingSectorAnalysis.ts
 * 보유 종목 목록을 섹터별로 집계해 집중도·쏠림·베타를 반환한다.
 * 서버 사이드 전용 (getSectorAnalysis → Yahoo Finance 포함).
 */

import {
  getSectorAnalysis,
  findEntry,
  SECTOR_LABELS,
  type SectorId,
} from "./sectorMap";

// ── 입력 타입 ─────────────────────────────────────────────────────────────
/** client_holdings DB 행 + 가격 해소(KIS/avg_price) 결과를 그대로 넘긴다 */
export interface HoldingInput {
  name: string;
  ticker: string | null;       // 6자리 코드, 없으면 null
  quantity: number;
  avgPriceKrw: number | null;  // 매입단가 (현재가 없을 때 대용)
  currentPriceKrw?: number | null; // KIS 현재가 (있으면 우선)
}

// ── 출력 타입 ─────────────────────────────────────────────────────────────
export interface SectorHolding {
  name: string;
  ticker: string | null;
  valueKrw: number;
  weightPct: number; // 주식 합계 대비 %
}

export interface SectorBucket {
  sector: SectorId;
  sectorLabel: string;
  valueKrw: number;
  weightPct: number; // 주식 합계 대비 %
  holdings: SectorHolding[];
  // 섹터 ETF 기반 OLS 지표
  beta: number | null;
  volAnnual: number | null;   // ETF 연율화 변동성 %
  alphaAnnual: number | null; // KOSPI 대비 초과수익(연율화) %
  r2: number | null;
  etfTicker: string;
  isFallback: boolean;        // 섹터 미특정 → KOSPI 대체
  lowReliability: boolean;    // R² < LOW_R2_THRESHOLD → 참고 수준
}

export interface HoldingsSectorResult {
  sectorBuckets: SectorBucket[];   // 비중 내림차순
  topSector: {
    sector: SectorId;
    sectorLabel: string;
    weightPct: number;
  } | null;
  concentrationWarning: boolean;   // topSector.weightPct >= threshold
  concentrationThreshold: number;  // 50 (%)
  fallbackHoldings: {              // 매핑 없어 KOSPI로 폴백된 종목
    name: string;
    ticker: string | null;
    valueKrw: number;
  }[];
  totalValueKrw: number;           // 분석 대상 주식 합계
  avgBeta: number | null;          // 금액 가중 평균 베타
  avgVolAnnual: number | null;     // 금액 가중 평균 변동성 %
  analyzedAt: string;              // ISO 타임스탬프
}

// ── 상수 ──────────────────────────────────────────────────────────────────
const CONCENTRATION_THRESHOLD = 50; // % — 이 이상이면 쏠림 경고
const LOW_R2_THRESHOLD = 0.3;       // 바이오 등 저신뢰 섹터 기준

// ── 핵심 함수 ─────────────────────────────────────────────────────────────
/**
 * 보유 종목 목록을 받아 섹터 집중도·쏠림 경고·포트폴리오 베타를 반환한다.
 *
 * - `currentPriceKrw` 우선, 없으면 `avgPriceKrw` 사용 (매입단가 대용)
 * - 가격 정보가 전혀 없는 종목은 분석에서 제외
 * - 매핑 없는 종목 → sector="market" → KOSPI 폴백 (isFallback=true)
 * - getSectorAnalysis 내부 24h 캐시로 동일 섹터 ETF 재조회 방지
 */
export async function analyzeHoldingsBySector(
  holdings: HoldingInput[],
): Promise<HoldingsSectorResult> {
  // 1. 종목별 평가금액 + 섹터 확정
  const valued = holdings
    .map((h) => {
      const price = h.currentPriceKrw ?? h.avgPriceKrw ?? 0;
      const valueKrw = Math.max(0, h.quantity * price);
      const entry = findEntry(h.ticker ?? h.name);
      const sector: SectorId = entry?.sector ?? "market";
      return {
        name: entry?.name ?? h.name,
        ticker: h.ticker,
        valueKrw,
        sector,
      };
    })
    .filter((h) => h.valueKrw > 0); // 가격 정보 없는 종목 제외

  const totalValueKrw = valued.reduce((s, h) => s + h.valueKrw, 0);

  if (totalValueKrw === 0) {
    return {
      sectorBuckets: [],
      topSector: null,
      concentrationWarning: false,
      concentrationThreshold: CONCENTRATION_THRESHOLD,
      fallbackHoldings: [],
      totalValueKrw: 0,
      avgBeta: null,
      avgVolAnnual: null,
      analyzedAt: new Date().toISOString(),
    };
  }

  // 2. 섹터별 그룹핑
  const sectorGroups = new Map<SectorId, typeof valued>();
  for (const h of valued) {
    const group = sectorGroups.get(h.sector) ?? [];
    group.push(h);
    sectorGroups.set(h.sector, group);
  }

  // 3. 섹터별 getSectorAnalysis 병렬 호출 (섹터당 1회, 내부 24h 캐시 활용)
  const sectorKeys = Array.from(sectorGroups.keys());
  const sectorAnalyses = await Promise.all(
    sectorKeys.map(async (sector) => {
      const rep = sectorGroups.get(sector)![0];
      try {
        const analysis = await getSectorAnalysis(rep.ticker ?? rep.name);
        return { sector, analysis };
      } catch {
        return { sector, analysis: null };
      }
    }),
  );
  const analysisMap = new Map(sectorAnalyses.map((s) => [s.sector, s.analysis]));

  // 4. SectorBucket 조립
  type ValuedHolding = { name: string; ticker: string | null; valueKrw: number; sector: SectorId };
  const buckets: SectorBucket[] = [];
  for (const [sector, group] of Array.from(sectorGroups.entries())) {
    const sectorValue = (group as ValuedHolding[]).reduce((s: number, h: ValuedHolding) => s + h.valueKrw, 0);
    const weightPct = (sectorValue / totalValueKrw) * 100;
    const a = analysisMap.get(sector as SectorId);

    buckets.push({
      sector: sector as SectorId,
      sectorLabel: SECTOR_LABELS[sector as SectorId],
      valueKrw: sectorValue,
      weightPct,
      holdings: (group as ValuedHolding[]).map((h: ValuedHolding) => ({
        name: h.name,
        ticker: h.ticker,
        valueKrw: h.valueKrw,
        weightPct: (h.valueKrw / totalValueKrw) * 100,
      })),
      beta:        a?.beta          ?? null,
      volAnnual:   a?.volatilityAnnual ?? null,
      alphaAnnual: a?.alphaAnnual   ?? null,
      r2:          a?.r2            ?? null,
      etfTicker:   a?.etfCode       ?? "^KS11",
      isFallback:  a?.isFallback    ?? true,
      lowReliability: a?.r2 != null ? a.r2 < LOW_R2_THRESHOLD : true,
    });
  }

  // 비중 내림차순
  buckets.sort((a, b) => b.weightPct - a.weightPct);

  // 5. 집중도 / 경고
  const top = buckets[0] ?? null;
  const concentrationWarning = (top?.weightPct ?? 0) >= CONCENTRATION_THRESHOLD;

  // 6. 폴백 종목 목록
  const fallbackHoldings = (sectorGroups.get("market") ?? []).map((h) => ({
    name: h.name,
    ticker: h.ticker,
    valueKrw: h.valueKrw,
  }));

  // 7. 금액 가중 포트폴리오 평균 베타 · 변동성
  let betaSum = 0, betaW = 0, volSum = 0, volW = 0;
  for (const b of buckets) {
    if (b.beta !== null)      { betaSum += b.beta      * b.valueKrw; betaW += b.valueKrw; }
    if (b.volAnnual !== null) { volSum  += b.volAnnual * b.valueKrw; volW  += b.valueKrw; }
  }

  return {
    sectorBuckets: buckets,
    topSector: top
      ? { sector: top.sector, sectorLabel: top.sectorLabel, weightPct: top.weightPct }
      : null,
    concentrationWarning,
    concentrationThreshold: CONCENTRATION_THRESHOLD,
    fallbackHoldings,
    totalValueKrw,
    avgBeta:      betaW > 0 ? betaSum / betaW : null,
    avgVolAnnual: volW  > 0 ? volSum  / volW  : null,
    analyzedAt:   new Date().toISOString(),
  };
}
