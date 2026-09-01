import type { EnrichedBar } from "./tickerIndicatorsExtended";

export interface ChartLayout {
  width: number;
  height: number;
  paddingLeft: number;
  paddingRight: number;
  paddingTop: number;
  paddingBottom: number;
}

export interface ChartScales {
  minPrice: number;
  maxPrice: number;
  times: string[];
}

export function defaultLayout(width: number, height: number): ChartLayout {
  return {
    width,
    height,
    paddingLeft: 56,
    paddingRight: 16,
    paddingTop: 12,
    paddingBottom: 28,
  };
}

export function scalesFromBars(bars: EnrichedBar[]): ChartScales {
  const lows = bars.map((b) => b.low);
  const highs = bars.map((b) => b.high);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const pad = (max - min) * 0.06 || max * 0.02;
  return {
    minPrice: min - pad,
    maxPrice: max + pad,
    times: bars.map((b) => b.time),
  };
}

export function plotWidth(layout: ChartLayout) {
  return layout.width - layout.paddingLeft - layout.paddingRight;
}

export function plotHeight(layout: ChartLayout) {
  return layout.height - layout.paddingTop - layout.paddingBottom;
}

export function timeToX(time: string, scales: ChartScales, layout: ChartLayout): number {
  const idx = scales.times.indexOf(time);
  const n = Math.max(scales.times.length - 1, 1);
  const ratio = idx >= 0 ? idx / n : 0;
  return layout.paddingLeft + ratio * plotWidth(layout);
}

export function priceToY(price: number, scales: ChartScales, layout: ChartLayout): number {
  const span = scales.maxPrice - scales.minPrice || 1;
  const ratio = (scales.maxPrice - price) / span;
  return layout.paddingTop + ratio * plotHeight(layout);
}

export function xToTime(x: number, scales: ChartScales, layout: ChartLayout): string {
  const ratio = Math.min(1, Math.max(0, (x - layout.paddingLeft) / plotWidth(layout)));
  const idx = Math.round(ratio * Math.max(scales.times.length - 1, 0));
  return scales.times[idx] ?? scales.times[scales.times.length - 1] ?? "";
}

export function yToPrice(y: number, scales: ChartScales, layout: ChartLayout): number {
  const ratio = Math.min(1, Math.max(0, (y - layout.paddingTop) / plotHeight(layout)));
  return scales.maxPrice - ratio * (scales.maxPrice - scales.minPrice);
}

export function pointerToTP(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  scales: ChartScales,
  layout: ChartLayout,
): { time: string; price: number; x: number; y: number } {
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  return {
    x,
    y,
    time: xToTime(x, scales, layout),
    price: yToPrice(y, scales, layout),
  };
}
