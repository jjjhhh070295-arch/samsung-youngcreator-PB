import type { Fundamentals, Warning } from "./types";
import { bondEtfSymbolKey } from "./bondEtfSettings";

const ACE_FUND_CODE = "K55101EN6525";
const ACE_PRODUCT_URL = `https://papi.aceetf.co.kr/api/funds/${ACE_FUND_CODE}/product`;
const ACE_YTM_URL = `https://papi.aceetf.co.kr/api/funds/${ACE_FUND_CODE}/ytmcalc`;
const ACE_PAGE_URL = `https://www.aceetf.co.kr/fund/${ACE_FUND_CODE}`;
const LQD_PAGE_URL =
  "https://www.ishares.com/us/products/239566/ishares-iboxx-investment-grade-corporate-bond-etf";

export type OfficialBondEtfFundamentals = {
  fundamentals: Fundamentals;
  source: string[];
  warnings: Warning[];
};

function finiteNumber(value: unknown): number | null {
  const parsed = typeof value === "string" ? Number(value.replaceAll(",", "")) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function pctToDecimal(value: unknown): number | undefined {
  const parsed = finiteNumber(value);
  return parsed != null && parsed >= -10 && parsed <= 100 ? parsed / 100 : undefined;
}

function positiveYears(value: unknown): number | undefined {
  const parsed = finiteNumber(value);
  return parsed != null && parsed >= 0 && parsed <= 50 ? parsed : undefined;
}

function yyyymmdd(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const digits = value.replace(/\D/g, "").slice(0, 8);
  return /^\d{8}$/.test(digits)
    ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`
    : undefined;
}

export function parseAceBondEtfFundamentals(
  ytmPayload: any,
  productPayload: any,
): Fundamentals {
  const ytm = pctToDecimal(ytmPayload?.ytm ?? productPayload?.fundYtm);
  const duration = positiveYears(ytmPayload?.duration ?? productPayload?.fundDur);
  const expenseRatio = pctToDecimal(
    ytmPayload?.totalPee ?? ytmPayload?.totalFee ?? productPayload?.total_FEE,
  );
  const factsAsOf = yyyymmdd(
    ytmPayload?.std_DT ?? ytmPayload?.stdDt ?? productPayload?.std_DT ?? productPayload?.stdDt,
  );
  return {
    ...(ytm != null ? { yieldToMaturity: ytm } : {}),
    ...(duration != null ? { duration } : {}),
    ...(expenseRatio != null ? { expenseRatio } : {}),
    ...(factsAsOf ? { factsAsOf } : {}),
    factsSourceLabel: "ACE ETF 공식 상품 공시",
    factsSourceUrl: ACE_PAGE_URL,
  };
}

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&#37;", "%")
    .replaceAll("&nbsp;", " ");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function metricNearLabel(html: string, label: string): { value?: number; asOf?: string } {
  const marker = `"label":"${label}"`;
  const index = html.indexOf(marker);
  if (index < 0) return {};
  const before = html.slice(Math.max(0, index - 900), index);
  const after = html.slice(index, index + 900);
  const beforeValues = Array.from(
    before.matchAll(/"formattedValue"\s*:\s*"([^"<]+)"/g),
  );
  const afterValue = after.match(/"formattedValue"\s*:\s*"([^"<]+)"/);
  const text = beforeValues.at(-1)?.[1] ?? afterValue?.[1];
  const value = text ? finiteNumber(text.replace(/[%a-zA-Z ]/g, "")) : null;
  const dateMatches = Array.from(
    before.matchAll(/"asOfDate"\s*:\s*"(\d{4}-\d{2}-\d{2})/g),
  );
  const afterDate = after.match(/"asOfDate"\s*:\s*"(\d{4}-\d{2}-\d{2})/);
  return {
    ...(value != null ? { value } : {}),
    ...(dateMatches.at(-1)?.[1] || afterDate?.[1]
      ? { asOf: dateMatches.at(-1)?.[1] ?? afterDate?.[1] }
      : {}),
  };
}

function propertyValue(html: string, label: string): number | undefined {
  const escaped = escapeRegExp(label);
  const patterns = [
    new RegExp(`"name"\\s*:\\s*"${escaped}:?"[^{}]{0,250}"value"\\s*:\\s*"?([0-9.,-]+)`),
    new RegExp(`"label"\\s*:\\s*"${escaped}"[^{}]{0,250}"formattedValue"\\s*:\\s*"([0-9.,-]+)`),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = finiteNumber(match?.[1]);
    if (value != null) return value;
  }
  return undefined;
}

function visibleAsOfDateForLabel(html: string, label: string): string | undefined {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  const index = text.indexOf(label);
  if (index < 0) return undefined;
  const nearby = text.slice(index, index + 700);
  const match = nearby.match(/as of\s+([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/i);
  if (!match) return undefined;
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    .indexOf(match[1].toLowerCase()) + 1;
  if (month <= 0) return undefined;
  return `${match[3]}-${String(month).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`;
}

export function parseLqdBondEtfFundamentals(rawHtml: string): Fundamentals {
  const html = decodeHtmlEntities(rawHtml);
  const ytm = metricNearLabel(html, "Average Yield to Maturity");
  const duration = metricNearLabel(html, "Effective Duration");
  const secYield = metricNearLabel(html, "30 Day SEC Yield");
  const distributionYield = metricNearLabel(html, "12m Trailing Yield");
  const expenseRatio = propertyValue(html, "Expense Ratio");
  const factsAsOf = ytm.asOf ?? visibleAsOfDateForLabel(html, "Average Yield to Maturity")
    ?? duration.asOf ?? secYield.asOf ?? distributionYield.asOf;
  return {
    ...(ytm.value != null ? { yieldToMaturity: ytm.value / 100 } : {}),
    ...(duration.value != null ? { duration: duration.value } : {}),
    ...(secYield.value != null ? { secYield: secYield.value / 100 } : {}),
    ...(distributionYield.value != null
      ? { distributionYield: distributionYield.value / 100 }
      : {}),
    ...(expenseRatio != null ? { expenseRatio: expenseRatio / 100 } : {}),
    ...(factsAsOf ? { factsAsOf } : {}),
    factsSourceLabel: "iShares LQD 공식 상품 공시",
    factsSourceUrl: LQD_PAGE_URL,
  };
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "user-agent": "Mozilla/5.0 PB-portfolio-analytics/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`공식 공시 응답 ${response.status}`);
  return response.json();
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { "user-agent": "Mozilla/5.0 PB-portfolio-analytics/1.0" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`공식 공시 응답 ${response.status}`);
  return response.text();
}

export async function fetchOfficialBondEtfFundamentals(
  ticker: string,
): Promise<OfficialBondEtfFundamentals | null> {
  const key = bondEtfSymbolKey(ticker);
  try {
    if (key === "0099L0") {
      const [ytmPayload, productPayload] = await Promise.all([
        fetchJson(ACE_YTM_URL),
        fetchJson(ACE_PRODUCT_URL),
      ]);
      const fundamentals = parseAceBondEtfFundamentals(ytmPayload, productPayload);
      if (fundamentals.yieldToMaturity == null) throw new Error("ACE YTM 항목 없음");
      return {
        fundamentals,
        source: [ACE_PAGE_URL, ACE_YTM_URL],
        warnings: [],
      };
    }
    if (key === "LQD") {
      const fundamentals = parseLqdBondEtfFundamentals(await fetchText(LQD_PAGE_URL));
      if (fundamentals.yieldToMaturity == null) throw new Error("LQD YTM 항목 없음");
      return { fundamentals, source: [LQD_PAGE_URL], warnings: [] };
    }
    return null;
  } catch (error) {
    return {
      fundamentals: {},
      source: [],
      warnings: [{
        type: "BOND_ETF_FACTS_UNAVAILABLE",
        ticker,
        message: `운용사 공식 YTM·듀레이션 조회 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}. PB 검증값 또는 과거 수익률 대용치를 확인하세요.`,
      }],
    };
  }
}
