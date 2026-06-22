/**
 * lib/autoSectorMap.ts
 * KRX ETF 구성종목(scripts/etf-constituents.json) 기반 자동 역매핑.
 * 모듈 로드 시 한 번 빌드, 이후 O(1) 조회.
 * 서버 사이드 전용.
 */

import etfData from "../scripts/etf-constituents.json";

// SectorId는 sectorMap.ts에서 가져오면 순환참조. 여기서 독립 정의.
type SectorIdCore = "semiconductor" | "battery" | "bio" | "finance" | "energy_chem" | "healthcare" | "steel" | "it" | "auto";

// ETF 단축코드 → SectorId
const ETF_TO_SECTOR: Record<string, SectorIdCore> = {
  "091160": "semiconductor",
  "305720": "battery",
  "244580": "bio",
  "139270": "finance",
  "266360": "it",
  "091180": "auto",
  "117460": "energy_chem",
  "117680": "steel",
};

export interface AutoEntry {
  code:      string;
  name:      string;
  sector:    SectorIdCore;
  etfTicker: string;  // "091160" 형식
  weightPct: number;
}

// 종목코드 → 비중 최대 섹터
const _reverseMap = new Map<string, AutoEntry>();

for (const [ticker, etf] of Object.entries(etfData.etfs)) {
  const sector = ETF_TO_SECTOR[ticker];
  if (!sector) continue;

  for (const h of (etf as any).holdings as { code: string; name: string; weightPct: number | null }[]) {
    if (!h.code || h.code.startsWith("KRD")) continue; // 현금·채권 스킵

    const w        = h.weightPct ?? 0;
    const existing = _reverseMap.get(h.code);

    if (!existing || existing.weightPct < w) {
      _reverseMap.set(h.code, {
        code:      h.code,
        name:      h.name,
        sector,
        etfTicker: ticker,
        weightPct: w,
      });
    }
  }
}

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

/** 캡처 날짜 */
export const AUTO_MAP_DATE: string = etfData.trdDd;
