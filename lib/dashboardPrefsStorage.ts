// PB별 홈 전광판 지표 설정 — 브라우저 저장.
//
// lib/advisory/pbScheduleStorage.ts / lib/investmentSurveyStorage.ts 와 같은 관용구를
// 쓴다(pb 스코프 키 + safeParse + typeof window 가드). 새 패턴을 만들지 않는다.
//
// 저장 위치가 localStorage 라 기기 간 동기화는 안 된다. 대시보드 설정은 개인 취향이고
// 잃어도 기본값으로 돌아갈 뿐이라 이 단계에서는 그 한계를 받아들인다 — 동기화가
// 필요해지면 pb_preferences 테이블로 옮기고 이 모듈의 시그니처만 유지하면 된다.

import {
  DEFAULT_INDICATOR_IDS,
  MAX_INDICATORS,
  MIN_INDICATORS,
  sanitizeIndicatorIds,
} from "@/lib/marketIndicators";

const STORAGE_KEY = (pbId: string) => `pb-dashboard:${pbId || "default"}`;

interface StoredPrefs {
  indicatorIds: string[];
}

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * 저장된 지표 목록. 없거나 깨졌거나 최소 개수 미만이면 기본값을 준다.
 * 레지스트리에서 사라진 id 는 sanitize 단계에서 조용히 빠진다 — 지표를 없애도
 * PB 설정이 깨지지 않게.
 */
export function loadDashboardIndicators(pbId: string): string[] {
  if (typeof window === "undefined") return [...DEFAULT_INDICATOR_IDS];
  const parsed = safeParse<StoredPrefs>(window.localStorage.getItem(STORAGE_KEY(pbId)));
  const cleaned = sanitizeIndicatorIds(parsed?.indicatorIds ?? []);
  return cleaned.length >= MIN_INDICATORS ? cleaned : [...DEFAULT_INDICATOR_IDS];
}

/** 저장 전에도 sanitize 한다 — 화면 버그로 잘못된 id 가 들어와도 파일에 남지 않게. */
export function saveDashboardIndicators(pbId: string, ids: readonly string[]): void {
  if (typeof window === "undefined") return;
  const cleaned = sanitizeIndicatorIds(ids).slice(0, MAX_INDICATORS);
  const payload: StoredPrefs = { indicatorIds: cleaned };
  try {
    window.localStorage.setItem(STORAGE_KEY(pbId), JSON.stringify(payload));
  } catch {
    /* 용량 초과·프라이빗 모드 등 — 저장 실패해도 화면은 그대로 동작한다 */
  }
}

/** 기본값으로 되돌린다(저장된 값 삭제). */
export function resetDashboardIndicators(pbId: string): string[] {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY(pbId));
    } catch {
      /* ignore */
    }
  }
  return [...DEFAULT_INDICATOR_IDS];
}
