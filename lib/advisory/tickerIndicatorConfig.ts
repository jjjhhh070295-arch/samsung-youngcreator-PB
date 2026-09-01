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
  { kind: "sma", label: "이동평균선", description: "5·20·60·120일 SMA", placement: "overlay" },
  { kind: "bollinger", label: "볼린저밴드", description: "20일 ±2σ", placement: "overlay" },
  { kind: "volume_profile", label: "매물대", description: "거래량 기반 가격대 분포", placement: "overlay" },
  { kind: "streak", label: "3연속 상승/하락", description: "캔들 마커", placement: "marker" },
  { kind: "rsi", label: "RSI", description: "RSI(14)", placement: "panel" },
  { kind: "macd", label: "MACD", description: "MACD(12,26,9)", placement: "panel" },
  { kind: "volume", label: "거래량", description: "일별 거래량", placement: "panel" },
  { kind: "supply_demand", label: "수급", description: "투자자별 순매수", placement: "panel" },
  { kind: "net_income", label: "당기순이익", description: "재무 스냅샷", placement: "panel" },
  { kind: "revenue_growth", label: "매출증가량", description: "YoY 매출 성장률", placement: "panel" },
];

export interface IndicatorSlot {
  id: string;
  kind: IndicatorKind;
  displayName: string;
}

export interface TickerIndicatorPrefs {
  version: 1;
  slots: IndicatorSlot[];
  updatedAt: string;
}

export const MAX_INDICATOR_SLOTS = 5;

export const DEFAULT_INDICATOR_PREFS: TickerIndicatorPrefs = {
  version: 1,
  updatedAt: new Date(0).toISOString(),
  slots: [
    { id: "s1", kind: "sma", displayName: "단기 모멘텀" },
    { id: "s2", kind: "rsi", displayName: "RSI" },
    { id: "s3", kind: "macd", displayName: "MACD" },
    { id: "s4", kind: "volume", displayName: "거래량" },
    { id: "s5", kind: "supply_demand", displayName: "수급+거래량" },
  ],
};

export function catalogLabel(kind: IndicatorKind): string {
  return INDICATOR_CATALOG.find((o) => o.kind === kind)?.label ?? kind;
}

export function isOverlayKind(kind: IndicatorKind): boolean {
  const opt = INDICATOR_CATALOG.find((o) => o.kind === kind);
  return opt?.placement === "overlay" || opt?.placement === "marker";
}
