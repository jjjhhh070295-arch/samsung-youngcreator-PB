/** Format a price for chart axis / tooltip display. */
export function formatChartPrice(price: number, currency: string): string {
  const cur = currency.toUpperCase();
  if (cur === "KRW") {
    return Math.round(price).toLocaleString("ko-KR");
  }
  return price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatChartVolume(volume: number): string {
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 1_000) return `${(volume / 1_000).toFixed(1)}K`;
  return volume.toLocaleString("ko-KR");
}

/** Generate evenly spaced price ticks for the Y-axis. */
export function priceAxisTicks(minPrice: number, maxPrice: number, targetCount = 5): number[] {
  const span = maxPrice - minPrice;
  if (!Number.isFinite(span) || span <= 0) return [minPrice];

  const rawStep = span / Math.max(targetCount - 1, 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  let niceStep = magnitude;
  if (normalized <= 1) niceStep = magnitude;
  else if (normalized <= 2) niceStep = 2 * magnitude;
  else if (normalized <= 5) niceStep = 5 * magnitude;
  else niceStep = 10 * magnitude;

  const start = Math.ceil(minPrice / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let p = start; p <= maxPrice + niceStep * 0.001; p += niceStep) {
    ticks.push(Number(p.toPrecision(12)));
  }
  if (ticks.length === 0) ticks.push(minPrice, maxPrice);
  return ticks;
}
