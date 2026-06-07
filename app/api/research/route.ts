import { NextResponse } from "next/server";
import {
  FALLBACK_MARKET_RESEARCH,
  RESEARCH_SOURCES,
  inferSignals,
  type MarketResearchItem,
  type ResearchSource,
} from "@/lib/portfolioResearch";

export const dynamic = "force-dynamic";

const MAX_ITEMS = 20;

function decodeHtmlEntity(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function cleanText(value: string) {
  return decodeHtmlEntity(value)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDate(raw?: string) {
  if (!raw) return undefined;

  const valid = (year: string, month: string, day: string) => {
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return undefined;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  };

  const compact = raw.match(/(20\d{2})(\d{2})(\d{2})/);
  if (compact) return valid(compact[1], compact[2], compact[3]);

  const numeric = raw.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  if (numeric) return valid(numeric[1], numeric[2], numeric[3]);

  const shortYear = raw.match(/(?<!\d)(\d{2})[./-](\d{1,2})[./-](\d{1,2})(?!\d)/);
  if (shortYear) return valid(`20${shortYear[1]}`, shortYear[2], shortYear[3]);

  const english = raw.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),\s+(20\d{2})/i);
  if (english) {
    const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(
      english[1].toLowerCase(),
    );
    return valid(english[3], String(month + 1), english[2]);
  }

  return undefined;
}

function absolutizeUrl(href: string, base: string) {
  if (!href || href.startsWith("javascript:")) return base;
  try {
    return new URL(decodeHtmlEntity(href), base).toString();
  } catch {
    return base;
  }
}

function itemId(source: string, title: string, url: string) {
  return `${source}-${title}-${url}`
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function decodeBuffer(buffer: ArrayBuffer, contentType: string) {
  const charset = contentType.match(/charset=([^;\s]+)/i)?.[1]?.toLowerCase();
  const encoding = charset?.includes("euc") || charset?.includes("ks_c") ? "euc-kr" : "utf-8";
  try {
    return new TextDecoder(encoding).decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

function extractMiraeItems(html: string, source: ResearchSource): MarketResearchItem[] {
  const items: MarketResearchItem[] = [];
  const rowPattern =
    /<td[^>]*>\s*(20\d{2}[-./]\d{1,2}[-./]\d{1,2})\s*<\/td>[\s\S]{0,900}?<div class="subject">\s*<a[^>]*>([\s\S]*?)<\/a>\s*<\/div>[\s\S]{0,900}?downConfirm\('([^']+)'/gi;

  for (const match of Array.from(html.matchAll(rowPattern))) {
    const date = normalizeDate(match[1]);
    const title = cleanText(match[2]);
    if (title.length < 4) continue;
    const url = absolutizeUrl(match[3], source.url);
    const text = `${title} ${date ?? ""}`;
    items.push({
      id: itemId(source.name, title, url),
      title,
      source: source.name,
      url,
      date,
      excerpt: "미래에셋증권 리서치 목록에서 추출한 최신 리포트입니다.",
      signals: inferSignals(text),
    });
  }

  return items;
}

function extractNaverFinanceItems(html: string, source: ResearchSource): MarketResearchItem[] {
  const items: MarketResearchItem[] = [];
  const rowPattern =
    /<tr>\s*<td[^>]*>\s*<a href="([^"]+)">([\s\S]*?)<\/a>\s*<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td class="file">([\s\S]*?)<\/td>\s*<td class="date"[^>]*>([\s\S]*?)<\/td>/gi;

  for (const match of Array.from(html.matchAll(rowPattern))) {
    const title = cleanText(match[2]);
    const brokerage = cleanText(match[3]);
    const fileCell = match[4] ?? "";
    const pdfMatch = fileCell.match(/<a href="([^"]+)"/i);
    const url = absolutizeUrl(pdfMatch?.[1] ?? match[1], source.url);
    const date = normalizeDate(cleanText(match[5]));
    if (title.length < 4 || brokerage.length < 2) continue;

    const sourceName = `${source.name} · ${brokerage}`;
    const text = `${title} ${brokerage} ${source.name}`;
    items.push({
      id: itemId(sourceName, title, url),
      title,
      source: sourceName,
      url,
      date,
      excerpt: `${brokerage}에서 제공한 ${source.name.replace("네이버 금융 ", "")}입니다.`,
      signals: inferSignals(text),
    });
  }

  return items;
}

function extractGenericItems(html: string, source: ResearchSource): MarketResearchItem[] {
  const items: MarketResearchItem[] = [];
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const financeWords =
    /시장|마켓|전략|리포트|투자|증시|주식|채권|금리|환율|반도체|AI|ETF|market|analysis|stock|bond|fed|yield|treasury|tech|semiconductor|report|portfolio/i;

  for (const match of Array.from(html.matchAll(anchorPattern))) {
    const rawHref = match[1];
    const title = cleanText(match[2]);
    if (title.length < 8 || title.length > 180 || !financeWords.test(title + rawHref)) continue;

    const nearby = html.slice(Math.max(0, match.index - 220), Math.min(html.length, match.index + 520));
    const date = normalizeDate(nearby) ?? normalizeDate(title);
    const url = absolutizeUrl(rawHref, source.url);
    const text = `${title} ${nearby}`;
    const signals = inferSignals(text);

    items.push({
      id: itemId(source.name, title, url),
      title,
      source: source.name,
      url,
      date,
      excerpt: cleanText(nearby).slice(0, 180),
      signals,
    });
  }

  return items;
}

async function fetchSource(source: ResearchSource) {
  const res = await fetch(source.url, {
    cache: "no-store",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!res.ok) throw new Error(`${source.name} ${res.status}`);
  const html = decodeBuffer(await res.arrayBuffer(), res.headers.get("content-type") ?? "");
  const siteItems = source.url.includes("finance.naver.com/research")
    ? extractNaverFinanceItems(html, source)
    : source.name.includes("미래에셋증권")
      ? extractMiraeItems(html, source)
      : extractGenericItems(html, source);

  return siteItems.map((item) => ({
    ...item,
    signals: item.signals.length > 0 ? item.signals : inferSignals(`${item.title} ${item.excerpt ?? ""}`),
  }));
}

function uniqueLatest(items: MarketResearchItem[]) {
  const seen = new Set<string>();
  const sorted = items
    .filter((item) => {
      const key = `${item.source}|${item.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  const picked: MarketResearchItem[] = [];
  const sourceCounts = new Map<string, number>();
  const sourceGroup = (item: MarketResearchItem) => item.source.split(" · ")[0];

  for (const item of sorted) {
    const group = sourceGroup(item);
    if ((sourceCounts.get(group) ?? 0) >= 6) continue;
    picked.push(item);
    sourceCounts.set(group, (sourceCounts.get(group) ?? 0) + 1);
    if (picked.length >= MAX_ITEMS) return picked;
  }

  for (const item of sorted) {
    if (picked.some((pickedItem) => pickedItem.id === item.id)) continue;
    picked.push(item);
    if (picked.length >= MAX_ITEMS) break;
  }

  return picked;
}

export async function GET() {
  const settled = await Promise.allSettled(RESEARCH_SOURCES.map(fetchSource));
  const fetched = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const fallbackNeeded = fetched.length < MAX_ITEMS;
  const items = uniqueLatest(fallbackNeeded ? [...fetched, ...FALLBACK_MARKET_RESEARCH] : fetched);

  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    sourceCount: RESEARCH_SOURCES.length,
    fetchedCount: fetched.length,
    fallbackUsed: fallbackNeeded,
    sources: RESEARCH_SOURCES,
    items,
  });
}
