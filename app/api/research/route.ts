import { NextResponse } from "next/server";
import {
  FALLBACK_MARKET_RESEARCH,
  RESEARCH_SOURCES,
  inferSignals,
  type MarketResearchItem,
  type ResearchSource,
} from "@/lib/portfolioResearch";
import { getCachedAnalyses } from "@/lib/researchSignalsStore";

export const dynamic = "force-dynamic";

const MAX_ITEMS = 30;
const PER_SOURCE_CAP = 4; // 한 출처(증권사)당 최대 건수 — 다양성 확보

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

// 개별 종목 리포트 판별 — 종목코드(예: (005930, (353200.KS, (0011A0) 또는
// 투자의견(/매수·/매도·/중립·/유지·Not Rated)이 붙은 제목은 종목 리포트로 본다(자산배분 근거 부적합).
function isStockReport(title: string): boolean {
  return /\([0-9A-Z]{6}|\/\s*(매수|매도|중립|유지|비중축소|Not\s?Rated)/i.test(title);
}

function extractMiraeItems(html: string, source: ResearchSource): MarketResearchItem[] {
  const items: MarketResearchItem[] = [];
  // 행(<tr>) 단위로 쪼개서 한 행씩 안전하게 파싱한다.
  // (전역 정규식은 PDF 없는 행을 만나면 제목 캡처가 다음 행까지 번져 "덩어리 제목"이 됨)
  const rows = html.split(/<tr[\s>]/i).slice(1);
  for (const row of rows) {
    const subj = row.match(/<div class="subject">\s*<a[^>]*>([\s\S]*?)<\/a>/i);
    if (!subj) continue;
    const title = cleanText(subj[1]);
    if (title.length < 4 || title.length > 160) continue; // 160자 초과는 비정상(덩어리) → 제외
    if (isStockReport(title)) continue; // 개별 종목 리포트 제외 — 거시/시황/전략만
    const date = normalizeDate((row.match(/(20\d{2}[-./]\d{1,2}[-./]\d{1,2})/) ?? [])[0]);
    const pdf = (row.match(/downConfirm\('([^']+)'/i) ?? [])[1];
    const view = row.match(/view\('(\d+)','(\d+)'\)/i);
    const url = pdf
      ? absolutizeUrl(pdf, source.url)
      : view
        ? `https://securities.miraeasset.com/bbs/board/message/view.do?messageId=${view[1]}&categoryId=${view[2]}`
        : source.url;
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
  // 네이버 금융 리포트 목록의 한 행:
  //  <td ...><a href="..._read.naver?...">제목</a><img NEW></td><td>증권사</td>
  //  <td class="file"><a href="...pdf">…</a></td><td class="date">날짜</td>
  // 제목 </a> 뒤에 NEW 아이콘 <img>가 붙을 수 있어 [\s\S]*?</td> 로 흡수한다.
  const rowPattern =
    /<td[^>]*>\s*<a href="([^"]*_read\.naver[^"]*)">([\s\S]*?)<\/a>[\s\S]*?<\/td>\s*<td>([\s\S]*?)<\/td>\s*<td class="file">([\s\S]*?)<\/td>\s*<td class="date"[^>]*>([\s\S]*?)<\/td>/gi;

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

// 한국투자증권 리서치 — <li class="view_con"> 리스트 구조.
// 제목=div.body, 분류=div.head, 날짜=마지막 <em>, 상세 id=doDetail('id').
// 상세페이지(StrategyDetail.jsp?id=…)가 본문 전문을 주므로 url을 그쪽으로 건다.
function extractKoreaInvestmentItems(html: string, source: ResearchSource): MarketResearchItem[] {
  const items: MarketResearchItem[] = [];
  const re =
    /class="view_con"[^>]*onclick="[^"]*doDetail\('(\d+)'\)[\s\S]*?<div class="head[^>]*>([\s\S]*?)<\/div>[\s\S]*?<div class="body">([\s\S]*?)<\/div>[\s\S]*?<em>([\s\S]*?)<\/em>[\s\S]*?<em>(20\d{2}[.\-]\d{2}[.\-]\d{2})<\/em>/gi;

  for (const match of Array.from(html.matchAll(re))) {
    const id = match[1];
    const head = cleanText(match[2]);
    const body = cleanText(match[3]);
    if (body.length < 3) continue;
    const title = (head ? `${head} · ${body}` : body).slice(0, 120);
    const date = normalizeDate(match[5]);
    const url = `https://securities.koreainvestment.com/main/research/research/StrategyDetail.jsp?jkGubun=6&id=${id}`;
    const text = `${title} ${date ?? ""}`;
    items.push({
      id: itemId(source.name, title, url),
      title,
      source: source.name,
      url,
      date,
      excerpt: "한국투자증권 리서치 상세에서 추출한 최신 리포트입니다.",
      signals: inferSignals(text),
    });
  }

  return items;
}

// 하나증권 리서치 — 목록에 제목·요약(j_bbsContn)·날짜가 인라인으로 들어있다.
// id="{bbsCd}_{bbsSeq}" 로 PDF 다운로드 URL을 구성한다. 종목 리포트는 제외.
function extractHanaItems(html: string, source: ResearchSource): MarketResearchItem[] {
  const items: MarketResearchItem[] = [];
  const re =
    /<a href="#" class="more_btn title"[^>]*id="(\d+)_(\d+)">([\s\S]*?)<\/a>[\s\S]*?<span class="none m-name">([\s\S]*?)<\/span>[\s\S]*?<span class="txtbasic">(20\d{2}[.\-]\d{1,2}[.\-]\d{1,2})<\/span>[\s\S]*?j_bbsContn[^>]*>([\s\S]*?)<\/li>/gi;

  for (const match of Array.from(html.matchAll(re))) {
    const bbsCd = match[1];
    const bbsSeq = match[2];
    const title = cleanText(match[3]);
    if (title.length < 4 || isStockReport(title)) continue; // 종목 리포트 제외
    const date = normalizeDate(match[5]);
    const excerpt = cleanText(match[6]).slice(0, 400);
    const url = `https://www.hanaw.com/main/research/research/download.cmd?bbsSeq=${bbsSeq}&attachFileSeq=1&bbsId=&dbType=&bbsCd=${bbsCd}`;
    const text = `${title} ${excerpt} ${date ?? ""}`;
    items.push({
      id: itemId(source.name, title, url),
      title,
      source: source.name,
      url,
      date,
      excerpt: excerpt || "하나증권 리서치 목록에서 추출한 최신 리포트입니다.",
      signals: inferSignals(text),
    });
  }

  return items;
}

// 한경 컨센서스 — 전 증권사 리포트를 모아주는 애그리게이터(PDF 링크 포함).
// 테이블: [날짜][구분][제목+요약+PDF][작성자][제공출처]. 제공출처(증권사)별로 묶이도록 source에 붙인다.
// 구분이 "기업"/"기술적분석"인 개별기업 리포트는 제외(거시/시황/전략/산업만).
function extractHankyungItems(html: string, source: ResearchSource): MarketResearchItem[] {
  const items: MarketResearchItem[] = [];
  const tbody = html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>"));
  if (!tbody) return items;
  const rows = tbody.split(/<tr[\s>]/i).slice(1);
  for (const row of rows) {
    const tds = Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)).map((m) => m[1]);
    if (tds.length < 5) continue;
    const gubun = cleanText(tds[1]);
    if (gubun === "기업" || gubun === "기술적분석") continue; // 개별기업/기술적분석 제외
    const a = tds[2].match(/<a href="(\/analysis\/downpdf\?report_idx=\d+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!a) continue;
    const title = cleanText(a[2]);
    if (title.length < 4 || isStockReport(title)) continue;
    const url = absolutizeUrl(a[1], source.url);
    const provider = cleanText(tds[4] || "");
    const pop = tds[2].match(/<li>([\s\S]*?)<\/li>/i);
    const excerpt = pop ? cleanText(pop[1]).slice(0, 300) : "";
    const date = normalizeDate(cleanText(tds[0]));
    const sourceName = provider ? `${source.name} · ${provider}` : source.name;
    const text = `${title} ${excerpt} ${gubun}`;
    items.push({
      id: itemId(sourceName, title, url),
      title,
      source: sourceName,
      url,
      date,
      excerpt: excerpt || `한경컨센서스 ${gubun} · ${provider}`,
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
    : source.url.includes("koreainvestment.com")
      ? extractKoreaInvestmentItems(html, source)
      : source.url.includes("hanaw.com")
        ? extractHanaItems(html, source)
        : source.url.includes("consensus.hankyung.com")
          ? extractHankyungItems(html, source)
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
    if ((sourceCounts.get(group) ?? 0) >= PER_SOURCE_CAP) continue;
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
  const picked = uniqueLatest(fallbackNeeded ? [...fetched, ...FALLBACK_MARKET_RESEARCH] : fetched);

  // 캐시된 LLM 분석(방향·강도)을 주입 → 포트폴리오 엔진이 방향/강도까지 반영해 가중치 계산.
  // (분석 없는 항목은 그대로 키워드 신호로 동작)
  const cached = await getCachedAnalyses(picked.map((it) => it.id));
  const items = picked.map((it) => {
    const a = cached.get(it.id);
    if (!a || !a.signals?.length) return it;
    return {
      ...it,
      analysis: a.signals.map((s) => ({ signal: s.signal, direction: s.direction, strength: s.strength })),
    };
  });

  return NextResponse.json({
    updatedAt: new Date().toISOString(),
    sourceCount: RESEARCH_SOURCES.length,
    fetchedCount: fetched.length,
    fallbackUsed: fallbackNeeded,
    sources: RESEARCH_SOURCES,
    items,
  });
}
