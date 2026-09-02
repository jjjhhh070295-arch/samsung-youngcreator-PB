import {
  createDefaultPresets,
  DEFAULT_ANALYSIS_PRESETS,
  emptyIndicatorFlags,
  MAX_ANALYSIS_PRESETS,
  type AnalysisPreset,
  type IndicatorFlags,
  type IndicatorKind,
  type TickerAnalysisPresets,
} from "./tickerAnalysisPresets";
import type { DrawingDocument } from "./drawingTypes";
import type { OhlcTimeframe } from "./ohlcAggregate";
import { timeframeStorageSuffix } from "./ohlcAggregate";

const PRESETS_KEY = (pbId: string) => `ticker-analysis-presets:${pbId || "default"}`;
const ACTIVE_PRESET_KEY = (pbId: string) => `ticker-active-analysis-preset:${pbId || "default"}`;
const LEGACY_INDICATOR_KEY = (pbId: string) => `ticker-indicators:${pbId || "default"}`;
const LEGACY_DRAWING_KEY = (pbId: string, ticker: string) =>
  `ticker-drawings:${pbId || "default"}:${ticker.toUpperCase()}`;
const DRAWING_KEY = (pbId: string, ticker: string, timeframe: OhlcTimeframe) =>
  `ticker-drawings:${pbId || "default"}:${ticker.toUpperCase()}:${timeframeStorageSuffix(timeframe)}`;

function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Migrate legacy 5-slot indicator prefs → first preset if new key absent. */
function migrateLegacyIndicatorPrefs(pbId: string): TickerAnalysisPresets | null {
  if (typeof window === "undefined") return null;
  const legacy = safeParse<{
    version: 1;
    slots: Array<{ id: string; kind: IndicatorKind; displayName: string }>;
  }>(window.localStorage.getItem(LEGACY_INDICATOR_KEY(pbId)));
  if (!legacy?.slots?.length) return null;

  const presets = createDefaultPresets();
  const flags = emptyIndicatorFlags();
  for (const slot of legacy.slots.slice(0, MAX_ANALYSIS_PRESETS)) {
    flags[slot.kind] = true;
  }
  presets[0] = {
    id: presets[0].id,
    name: legacy.slots[0]?.displayName || presets[0].name,
    indicators: flags,
  };

  const migrated: TickerAnalysisPresets = {
    version: 2,
    updatedAt: new Date().toISOString(),
    presets,
  };
  saveAnalysisPresets(pbId, migrated);
  window.localStorage.removeItem(LEGACY_INDICATOR_KEY(pbId));
  return migrated;
}

export function loadAnalysisPresets(pbId: string): TickerAnalysisPresets {
  if (typeof window === "undefined") return DEFAULT_ANALYSIS_PRESETS;

  const parsed = safeParse<TickerAnalysisPresets>(
    window.localStorage.getItem(PRESETS_KEY(pbId)),
  );
  if (parsed?.presets?.length) {
    return {
      version: 2,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      presets: parsed.presets.slice(0, MAX_ANALYSIS_PRESETS).map(normalizePreset),
    };
  }

  const migrated = migrateLegacyIndicatorPrefs(pbId);
  if (migrated) return migrated;

  return DEFAULT_ANALYSIS_PRESETS;
}

function normalizePreset(p: AnalysisPreset): AnalysisPreset {
  const flags = emptyIndicatorFlags();
  for (const k of Object.keys(flags) as IndicatorKind[]) {
    flags[k] = Boolean(p.indicators?.[k]);
  }
  return { id: p.id, name: p.name || "사용자", indicators: flags };
}

export function saveAnalysisPresets(pbId: string, prefs: TickerAnalysisPresets): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    PRESETS_KEY(pbId),
    JSON.stringify({ ...prefs, version: 2, updatedAt: new Date().toISOString() }),
  );
}

export function loadActivePresetId(pbId: string): string {
  if (typeof window === "undefined") return "preset-1";
  const id = window.localStorage.getItem(ACTIVE_PRESET_KEY(pbId));
  if (id) return id;
  return "preset-1";
}

export function saveActivePresetId(pbId: string, presetId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(ACTIVE_PRESET_KEY(pbId), presetId);
}

export function loadDrawings(
  pbId: string,
  ticker: string,
  timeframe: OhlcTimeframe = "daily",
): DrawingDocument {
  const empty: DrawingDocument = {
    version: 1,
    objects: [],
    style: { color: "#1428A0", strokeWidth: 2, showLabels: true },
    updatedAt: new Date(0).toISOString(),
  };
  if (typeof window === "undefined") return empty;

  const key = DRAWING_KEY(pbId, ticker, timeframe);
  let parsed = safeParse<DrawingDocument>(window.localStorage.getItem(key));

  if (!parsed && timeframe === "daily") {
    parsed = safeParse<DrawingDocument>(
      window.localStorage.getItem(LEGACY_DRAWING_KEY(pbId, ticker)),
    );
    if (parsed) {
      saveDrawings(pbId, ticker, parsed, "daily");
      window.localStorage.removeItem(LEGACY_DRAWING_KEY(pbId, ticker));
    }
  }

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
  timeframe: OhlcTimeframe = "daily",
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    DRAWING_KEY(pbId, ticker, timeframe),
    JSON.stringify({ ...doc, updatedAt: new Date().toISOString() }),
  );
}
