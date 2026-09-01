export type IndicatorKind =
  | "rsi"
  | "macd"
  | "sma"
  | "volume_profile"
  | "volume"
  | "net_income"
  | "revenue_growth"
  | "bollinger"
  | "streak"
  | "supply_demand";

export interface IndicatorOption {
  kind: IndicatorKind;
  label: string;
  description: string;
  placement: "overlay" | "panel" | "marker";
}

export const INDICATOR_CATALOG: IndicatorOption[] = [
  { kind: "rsi", label: "RSI", description: "RSI(14)", placement: "panel" },
  { kind: "macd", label: "MACD", description: "MACD(12,26,9)", placement: "panel" },
  { kind: "sma", label: "이동평균선", description: "5·20·60·120일 SMA", placement: "overlay" },
  { kind: "volume_profile", label: "매물대", description: "거래량 기반 가격대 분포", placement: "overlay" },
  { kind: "volume", label: "거래량", description: "일별 거래량", placement: "panel" },
  { kind: "net_income", label: "당기순이익", description: "재무 스냅샷", placement: "panel" },
  { kind: "revenue_growth", label: "매출증가량", description: "YoY 매출 성장률", placement: "panel" },
  { kind: "bollinger", label: "볼린저밴드", description: "20일 ±2σ", placement: "overlay" },
  { kind: "streak", label: "3연속 상승/하락", description: "캔들 마커", placement: "marker" },
  { kind: "supply_demand", label: "수급", description: "투자자별 순매수", placement: "panel" },
];

export type IndicatorFlags = Record<IndicatorKind, boolean>;

export interface AnalysisPreset {
  id: string;
  name: string;
  indicators: IndicatorFlags;
}

export interface TickerAnalysisPresets {
  version: 2;
  presets: AnalysisPreset[];
  updatedAt: string;
}

export const MAX_ANALYSIS_PRESETS = 5;

export const ALL_INDICATOR_KINDS: IndicatorKind[] = INDICATOR_CATALOG.map((o) => o.kind);

export function emptyIndicatorFlags(): IndicatorFlags {
  return Object.fromEntries(ALL_INDICATOR_KINDS.map((k) => [k, false])) as IndicatorFlags;
}

function defaultFlags(overrides: Partial<IndicatorFlags> = {}): IndicatorFlags {
  return { ...emptyIndicatorFlags(), ...overrides };
}

export function createDefaultPresets(): AnalysisPreset[] {
  return [
    {
      id: "preset-1",
      name: "사용자 1",
      indicators: defaultFlags({ sma: true, rsi: true, macd: true, volume: true }),
    },
    {
      id: "preset-2",
      name: "사용자 2",
      indicators: defaultFlags({ sma: true, volume: true, supply_demand: true }),
    },
    {
      id: "preset-3",
      name: "사용자 3",
      indicators: defaultFlags({ bollinger: true, rsi: true, streak: true }),
    },
    {
      id: "preset-4",
      name: "사용자 4",
      indicators: defaultFlags({ macd: true, volume_profile: true, volume: true }),
    },
    {
      id: "preset-5",
      name: "사용자 5",
      indicators: defaultFlags({ net_income: true, revenue_growth: true, supply_demand: true }),
    },
  ];
}

export const DEFAULT_ANALYSIS_PRESETS: TickerAnalysisPresets = {
  version: 2,
  updatedAt: new Date(0).toISOString(),
  presets: createDefaultPresets(),
};

export function catalogLabel(kind: IndicatorKind): string {
  return INDICATOR_CATALOG.find((o) => o.kind === kind)?.label ?? kind;
}

export function isOverlayKind(kind: IndicatorKind): boolean {
  const opt = INDICATOR_CATALOG.find((o) => o.kind === kind);
  return opt?.placement === "overlay" || opt?.placement === "marker";
}

export function enabledIndicators(preset: AnalysisPreset): IndicatorKind[] {
  return ALL_INDICATOR_KINDS.filter((k) => preset.indicators[k]);
}

export function overlayIndicators(preset: AnalysisPreset): IndicatorKind[] {
  return enabledIndicators(preset).filter(isOverlayKind);
}

export function panelIndicators(preset: AnalysisPreset): IndicatorKind[] {
  return enabledIndicators(preset).filter((k) => !isOverlayKind(k));
}
