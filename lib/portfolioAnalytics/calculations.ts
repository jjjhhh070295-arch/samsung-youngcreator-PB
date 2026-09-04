import type { Drawdown, Price, Rebalance } from "./types";

export const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
export const daysBetween = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;
export function cleanPrices(prices: Price[]): Price[] {
  return Array.from(new Map(prices.filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date) &&
    Number.isFinite(Date.parse(p.date)) && finite(p.close) && p.close > 0).map(p => [p.date, p])).values())
    .sort((a, b) => a.date.localeCompare(b.date));
}
export function cagr(prices: Price[]): number | null {
  if (prices.length < 2) return null;
  const years = daysBetween(prices[0].date, prices[prices.length - 1].date) / 365.25;
  const value = Math.pow(prices[prices.length - 1].close / prices[0].close, 1 / years) - 1;
  return years > 0 && finite(value) ? value : null;
}
export function annualizedVolatility(returns: number[]): number | null {
  if (returns.length < 2 || !returns.every(finite)) return null;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const value = Math.sqrt(returns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (returns.length - 1)) * Math.sqrt(252);
  return finite(value) ? value : null;
}
export function drawdown(nav: Array<{ date: string; value: number }>): Drawdown | null {
  if (!nav.length) return null;
  let peak = 0, worstPeak = 0, trough = 0, mdd = 0;
  nav.forEach((p, i) => {
    if (p.value > nav[peak].value) peak = i;
    const dd = p.value / nav[peak].value - 1;
    if (dd < mdd) { mdd = dd; worstPeak = peak; trough = i; }
  });
  const recovered = mdd < 0 ? nav.findIndex((p, i) => i > trough && p.value >= nav[worstPeak].value) : -1;
  return { mdd, peakDate: nav[worstPeak].date, troughDate: nav[trough].date,
    recoveryDate: recovered < 0 ? null : nav[recovered].date,
    recoveryDays: recovered < 0 ? null : daysBetween(nav[worstPeak].date, nav[recovered].date) };
}
export function shouldRebalance(previous: string, current: string, mode: Rebalance): boolean {
  if (mode === "none") return false;
  const months = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 }[mode];
  const bucket = (date: string) => Number(date.slice(0, 4)) * 12 + Math.floor((Number(date.slice(5, 7)) - 1) / months) * months;
  return bucket(previous) !== bucket(current);
}
/** Each row contains same-date prices in the base currency. Rebalance at the
 * previous close before the first common observation of a new calendar period.
 * Between rebalances, units remain fixed and weights drift (including none). */
export function portfolioNav(dates: string[], rows: number[][], weights: number[], mode: Rebalance) {
  if (!dates.length) return [];
  let units = weights.map((w, i) => 100 * w / rows[0][i]);
  const nav = [{ date: dates[0], value: 100 }];
  for (let t = 1; t < dates.length; t++) {
    if (shouldRebalance(dates[t - 1], dates[t], mode)) {
      units = weights.map((w, i) => nav[t - 1].value * w / rows[t - 1][i]);
    }
    const value = units.reduce((sum, unit, i) => sum + unit * rows[t][i], 0);
    if (!finite(value) || value <= 0) throw new Error("NAV 계산 범위를 벗어났습니다.");
    nav.push({ date: dates[t], value });
  }
  return nav;
}
