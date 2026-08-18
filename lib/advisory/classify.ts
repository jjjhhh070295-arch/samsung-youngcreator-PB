import type { ProductCategory } from "./types";

export function classifyProduct(name: string, ticker?: string | null): ProductCategory {
  const text = `${name} ${ticker ?? ""}`.toLowerCase();
  if (/신탁|랩\b|일임|wrap|discretionary|맞춤형 포트/.test(text)) return "trust";
  if (/연금|irp|퇴직연금|연금저축/.test(text)) return "pension";
  if (/\bels\b|\belb\b|주가연계|파생결합|녹인|knock/.test(text)) return "els";
  if (/etf|kodex|tiger|kindex|arirang/.test(text)) return "etf";
  if (/채권|국고|국채|회사채|cp\b|mmf|rp\b|cma|단기채|agg bond|treasury|bond/.test(text)) return "bond";
  return "stock";
}

export function isOverseasProduct(name: string, ticker?: string | null, market?: string | null): boolean {
  const text = `${name} ${ticker ?? ""} ${market ?? ""}`.toLowerCase();
  if (/해외|미국|nasdaq|nyse|s&p|sp500|나스닥|달러|usd|adr|amzn|aapl|nvda|tsla|msft/.test(text)) return true;
  if (ticker && /[A-Za-z]/.test(ticker) && !/^\d{6}/.test(ticker)) return true;
  return false;
}
