/**
 * lib/autoSectorMap.ts
 * KRX ETF 구성종목(scripts/etf-constituents.json) 기반 자동 역매핑.
 * 모듈 로드 시 한 번 빌드, 이후 O(1) 조회.
 * 서버 사이드 전용.
 */

import etfData from "../scripts/etf-constituents.json";

// SectorId는 sectorMap.ts에서 가져오면 순환참조 → 여기서 독립 정의
export type SectorIdCore =
  | "semiconductor" | "battery" | "bio" | "finance"
  | "energy_chem"  | "healthcare" | "steel" | "it" | "auto";

export const ETF_TO_SECTOR: Record<string, SectorIdCore> = {
  "091160": "semiconductor",
  "305720": "battery",
  "244580": "bio",
  "139270": "finance",
  "266360": "it",
  "091180": "auto",
  "117460": "energy_chem",
  "117680": "steel",
};

export interface SectorMembership {
  sector:    SectorIdCore;
  etfTicker: string;   // "091160" 형식
  weightPct: number;
}

export interface AutoEntry {
  code:      string;
  name:      string;
  /** 최대 비중 ETF 기준 주 섹터 */
  sector:    SectorIdCore;
  etfTicker: string;
  weightPct: number;
  /** 주 섹터 외에 속한 ETF 목록 (비중 내림차순). 길이 0이면 단일 섹터. */
  secondarySectors: SectorMembership[];
}

// ── 역매핑 빌드 ──────────────────────────────────────────────────────────
// Step 1: 종목코드별 모든 ETF 소속 수집
const _allMemberships = new Map<string, { name: string; memberships: SectorMembership[] }>();

for (const [ticker, etf] of Object.entries(etfData.etfs)) {
  const sector = ETF_TO_SECTOR[ticker];
  if (!sector) continue;

  for (const h of (etf as { holdings: { code: string; name: string; weightPct: number | null }[] }).holdings) {
    if (!h.code || h.code.startsWith("KRD")) continue; // 현금·채권 스킵

    const entry = _allMemberships.get(h.code) ?? { name: h.name, memberships: [] };
    entry.memberships.push({ sector, etfTicker: ticker, weightPct: h.weightPct ?? 0 });
    _allMemberships.set(h.code, entry);
  }
}

// Step 2: 비중 내림차순 정렬 → 주 섹터(최대) + 부 섹터(나머지)
const _reverseMap = new Map<string, AutoEntry>();

for (const [code, { name, memberships }] of Array.from(_allMemberships)) {
  const sorted = [...memberships].sort((a, b) => b.weightPct - a.weightPct);
  const [primary, ...secondary] = sorted;
  _reverseMap.set(code, {
    code,
    name,
    sector:           primary.sector,
    etfTicker:        primary.etfTicker,
    weightPct:        primary.weightPct,
    secondarySectors: secondary,
  });
}

// ── 공개 API ──────────────────────────────────────────────────────────────

/** 6자리 종목코드 → 자동 매핑 엔트리. 없으면 null. */
export function getSectorByCode(code: string): AutoEntry | null {
  return _reverseMap.get(code.trim()) ?? null;
}

/** 전체 자동 매핑 Map 반환 (읽기 전용). */
export function getAutoSectorMap(): ReadonlyMap<string, AutoEntry> {
  return _reverseMap;
}

/** 자동 매핑 커버 종목 수 */
export const AUTO_MAP_SIZE = _reverseMap.size;

/** 캡처 기준일 */
export const AUTO_MAP_DATE: string = etfData.trdDd;
