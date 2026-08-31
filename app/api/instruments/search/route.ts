import { NextResponse } from "next/server";
import { fetchTickerQuote } from "@/lib/advisory/tickerData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AssetClass =
  | "domesticEquity"
  | "globalEquity"
  | "domesticBond"
  | "globalBond"
  | "alternatives";

type Instrument = {
  symbol: string;
  name: string;
  exchange: string;
  currency: string;
  kind: string;
  domesticCode: string | null;
  price: number | null;
  changePct: number | null;
  asOf: string | null;
  source: string;
};

const NAVER_HEADERS = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36",
  referer: "https://m.stock.naver.com/",
};

const BOND_WORDS = /채권|국채|회사채|단기채|종합채권|treasury|bond|fixed income/i;
const ALTERNATIVE_WORDS = /금|골드|은|실버|원유|WTI|브렌트|천연가스|구리|농산물|원자재|리츠|부동산|인프라|commodity|gold|silver|oil|gas|copper|agriculture|reit|infrastructure/i;
const GLOBAL_EXPOSURE_WORDS = /미국|나스닥|S&P|글로벌|선진국|일본|중국|차이나|인도|유럽|베트남|대만|홍콩|world|global|japan|china|india|europe|emerging/i;
const CASH_WORDS = /머니마켓|CD금리|KOFR|단기통안채|초단기|MMF|현금/i;
const DOMESTIC_ETF_BRANDS = /^(KODEX|TIGER|ACE|RISE|SOL|KOSEF|HANARO|PLUS|TIMEFOLIO|KBSTAR|ARIRANG|UNICORN|FOCUS|MASTER|TREX|히어로즈|파워|WON|1Q)\b/i;
const NON_COMMON_EQUITY_WORDS = /CEDEAR|depositary|ADR|GDR|warrant|right|unit|preferred|우선주/i;

function matchesClass(item: Instrument, assetClass: AssetClass) {
  const text = `${item.name} ${item.symbol} ${item.kind}`;
  const isEtf = /ETF/i.test(item.kind);
  const globalExposure = GLOBAL_EXPOSURE_WORDS.test(text);
  if (assetClass === "domesticEquity") return item.domesticCode != null && !globalExposure && !BOND_WORDS.test(text) && !ALTERNATIVE_WORDS.test(text) && !CASH_WORDS.test(text);
  if (assetClass === "globalEquity") {
    if (item.domesticCode != null) return isEtf && globalExposure && !BOND_WORDS.test(text) && !ALTERNATIVE_WORDS.test(text);
    return /EQUITY|ETF|ETN|OTHER|MUTUALFUND/i.test(item.kind) && !BOND_WORDS.test(text) && !ALTERNATIVE_WORDS.test(text);
  }
  if (assetClass === "domesticBond") return item.domesticCode != null && BOND_WORDS.test(text) && !globalExposure;
  if (assetClass === "globalBond") return BOND_WORDS.test(text) && (item.domesticCode == null || globalExposure);
  return ALTERNATIVE_WORDS.test(text);
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[\s._-]+/g, "");
}

async function searchNaverEtfCatalog(query: string): Promise<Instrument[]> {
  const response = await fetch("https://finance.naver.com/api/sise/etfItemList.naver", {
    headers: NAVER_HEADERS,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Naver Finance ETF 목록 연결 실패 (${response.status})`);
  const text = new TextDecoder("euc-kr").decode(await response.arrayBuffer());
  const items = JSON.parse(text)?.result?.etfItemList ?? [];
  const normalizedQuery = normalize(query);
  return items
    .filter((item: any) => normalize(`${item.itemname ?? ""}${item.itemcode ?? ""}`).includes(normalizedQuery))
    .map((item: any) => {
      const rate = Number(item.changeRate) || 0;
      const falling = String(item.risefall) === "4" || String(item.risefall) === "5";
      return {
        symbol: String(item.itemcode),
        name: String(item.itemname || item.itemcode),
        exchange: "KRX ETF",
        currency: "KRW",
        kind: "ETF",
        domesticCode: String(item.itemcode),
        price: Number(item.nowVal) || null,
        changePct: falling ? -Math.abs(rate) : rate,
        asOf: new Date().toISOString(),
        source: "Naver Finance ETF Catalog",
      } as Instrument;
    });
}

async function searchNaver(query: string): Promise<Instrument[]> {
  const response = await fetch(
    `https://ac.stock.naver.com/ac?q=${encodeURIComponent(query)}&target=stock,marketindicator,index`,
    { headers: NAVER_HEADERS, cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Naver Finance 검색 연결 실패 (${response.status})`);
  const items = (await response.json())?.items ?? [];
  return items
    .filter((item: any) => item?.nationCode === "KOR" && item?.category === "stock" && item?.code)
    .map((item: any) => {
      const name = String(item.name || item.code);
      return {
        symbol: String(item.code),
        name,
        exchange: String(item.typeName || item.typeCode || "KRX"),
        currency: "KRW",
        kind: /ETN/i.test(name)
          ? "ETN"
          : DOMESTIC_ETF_BRANDS.test(name) || /액티브|커버드콜/i.test(name)
            ? "ETF"
            : String(item.typeName || "국내 종목"),
        domesticCode: String(item.code),
        price: null,
        changePct: null,
        asOf: null,
        source: "Naver Finance",
      };
    });
}

async function searchYahoo(query: string): Promise<Instrument[]> {
  const response = await fetch(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=24&newsCount=0`,
    { headers: { "user-agent": NAVER_HEADERS["user-agent"] }, cache: "no-store" },
  );
  if (!response.ok) throw new Error(`Yahoo Finance 검색 연결 실패 (${response.status})`);
  const quotes = (await response.json())?.quotes ?? [];
  return quotes
    .filter((item: any) => item?.symbol && !/\.(KS|KQ)$/i.test(String(item.symbol)))
    .map((item: any) => {
      const name = String(item.longname || item.shortname || item.symbol);
      const productIdentity = `${name} ${item.symbol ?? ""} ${item.exchange ?? ""} ${item.exchDisp ?? ""}`;
      return {
        symbol: String(item.symbol),
        name,
        exchange: String(item.exchDisp || item.exchange || "GLOBAL"),
        currency: String(item.currency || "USD"),
        kind: /ETN|exchange.traded note/i.test(`${name} ${item.quoteType ?? ""}`)
          ? "ETN"
          : NON_COMMON_EQUITY_WORDS.test(productIdentity) || /\.BA$/i.test(String(item.symbol))
            ? "OTHER"
            : String(item.quoteType || "해외 종목"),
        domesticCode: null,
        price: null,
        changePct: null,
        asOf: null,
        source: "Yahoo Finance",
      };
    });
}

async function withQuote(item: Instrument): Promise<Instrument> {
  if (item.price != null) return item;
  try {
    const quote = await fetchTickerQuote({ symbol: item.symbol, domesticCode: item.domesticCode });
    return {
      ...item,
      symbol: quote.symbol || item.symbol,
      name: quote.name || item.name,
      exchange: quote.exchange || item.exchange,
      currency: quote.currency || item.currency,
      price: quote.price,
      changePct: quote.changePct,
      asOf: quote.asOf,
      source: `${item.source} · ${quote.source}`,
    };
  } catch {
    return item;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const assetClass = url.searchParams.get("assetClass") as AssetClass | null;
  if (query.length < 1 || !assetClass) {
    return NextResponse.json({ ok: false, error: "검색어와 자산군이 필요합니다." }, { status: 400 });
  }

  const useNaver = true;
  const useYahoo = assetClass === "globalEquity" || assetClass === "globalBond" || assetClass === "alternatives";
  const [naverResult, naverEtfResult, yahooResult] = await Promise.all([
    useNaver
      ? searchNaver(query).then((value) => ({ ok: true as const, value })).catch((error: unknown) => ({ ok: false as const, error }))
      : Promise.resolve({ ok: true as const, value: [] as Instrument[] }),
    searchNaverEtfCatalog(query).then((value) => ({ ok: true as const, value })).catch((error: unknown) => ({ ok: false as const, error })),
    useYahoo
      ? searchYahoo(query).then((value) => ({ ok: true as const, value })).catch((error: unknown) => ({ ok: false as const, error }))
      : Promise.resolve({ ok: true as const, value: [] as Instrument[] }),
  ]);
  const providerErrors = [
    useNaver && !naverResult.ok ? `Naver Finance: ${naverResult.error instanceof Error ? naverResult.error.message : "연결 실패"}` : null,
    !naverEtfResult.ok ? `Naver Finance ETF: ${naverEtfResult.error instanceof Error ? naverEtfResult.error.message : "연결 실패"}` : null,
    useYahoo && !yahooResult.ok ? `Yahoo Finance: ${yahooResult.error instanceof Error ? yahooResult.error.message : "연결 실패"}` : null,
  ].filter(Boolean);
  const allRequestedProvidersFailed = !naverResult.ok && !naverEtfResult.ok && (!useYahoo || !yahooResult.ok);
  if (allRequestedProvidersFailed) {
    return NextResponse.json({
      ok: false,
      error: "실시간 금융 데이터 제공처에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      providerErrors,
    }, { status: 502 });
  }
  const naver = naverResult.ok ? naverResult.value : [];
  const naverEtfs = naverEtfResult.ok ? naverEtfResult.value : [];
  const yahoo = yahooResult.ok ? yahooResult.value : [];
  const unique = Array.from(
    new Map([...naverEtfs, ...naver, ...yahoo].filter((item) => matchesClass(item, assetClass)).map((item) => [item.symbol, item])).values(),
  ).slice(0, 50);
  const results = await Promise.all(unique.map(withQuote));
  return NextResponse.json({ ok: true, results, providers: [naverResult.ok && "Naver Finance", naverEtfResult.ok && "Naver Finance ETF Catalog", useYahoo && yahooResult.ok && "Yahoo Finance"].filter(Boolean), providerErrors });
}
