import {
  DEFAULT_INDICATOR_PREFS,
  MAX_INDICATOR_SLOTS,
  type IndicatorKind,
  type IndicatorSlot,
  type TickerIndicatorPrefs,
} from "./tickerIndicatorConfig";
import type { DrawingDocument } from "./drawingTypes";

const INDICATOR_KEY = (pbId: string) => `ticker-indicators:${pbId || "default"}`;
const DRAWING_KEY = (pbId: string, ticker: string) =>
  `ticker-drawings:${pbId || "default"}:${ticker.toUpperCase()}`;

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function loadIndicatorPrefs(pbId: string): TickerIndicatorPrefs {
  if (typeof window === "undefined") return DEFAULT_INDICATOR_PREFS;
  const parsed = safeParse<TickerIndicatorPrefs>(
    window.localStorage.getItem(INDICATOR_KEY(pbId)),
  );
  if (!parsed?.slots?.length) return DEFAULT_INDICATOR_PREFS;
  return {
    version: 1,
    updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    slots: parsed.slots.slice(0, MAX_INDICATOR_SLOTS),
  };
}

export function saveIndicatorPrefs(pbId: string, prefs: TickerIndicatorPrefs): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    INDICATOR_KEY(pbId),
    JSON.stringify({ ...prefs, updatedAt: new Date().toISOString() }),
  );
}

export function createSlot(kind: IndicatorKind, displayName: string): IndicatorSlot {
  return {
    id: `slot-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    kind,
    displayName,
  };
}

export function loadDrawings(pbId: string, ticker: string): DrawingDocument {
  const empty: DrawingDocument = {
    version: 1,
    objects: [],
    style: { color: "#1428A0", strokeWidth: 2, showLabels: true },
    updatedAt: new Date(0).toISOString(),
  };
  if (typeof window === "undefined") return empty;
  const parsed = safeParse<DrawingDocument>(
    window.localStorage.getItem(DRAWING_KEY(pbId, ticker)),
  );
  if (!parsed) return empty;
  return {
    version: 1,
    objects: parsed.objects ?? [],
    style: parsed.style ?? empty.style,
    updatedAt: parsed.updatedAt ?? new Date().toISOString(),
  };
}

export function saveDrawings(
  pbId: string,
  ticker: string,
  doc: DrawingDocument,
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    DRAWING_KEY(pbId, ticker),
    JSON.stringify({ ...doc, updatedAt: new Date().toISOString() }),
  );
}
