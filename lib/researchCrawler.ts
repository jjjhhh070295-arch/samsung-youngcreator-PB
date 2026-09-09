import { WINDOW_DAYS, inferSignals, type MarketResearchItem, type ResearchSource } from "./portfolioResearch";

function anchors(html: string) {
  return Array.from(html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi), (m) => ({
    href: m[1].match(/\bhref\s*=\s*["']([^"']*)["']/i)?.[1] ?? "",
    text: m[2],
    attributes: m[1],
  }));
}

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

export function normalizeDate(raw?: string) {
  if (!raw) return undefined;

  const valid = (year: string, month: string, day: string) => {
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return undefined;
    const date = new Date(Date.UTC(y, m - 1, d));
    if (date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return undefined;
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

export function absolutizeUrl(href: string, base: string) {
  if (!href || /^(?:javascript:|#|data:|mailto:)/i.test(href.trim())) return "";
  try {
    const url = new URL(decodeHtmlEntity(href), base);
    if (!["https:", "http:"].includes(url.protocol)) return "";
    url.pathname = url.pathname.replace(/;jsessionid=[^/;?]+/gi, "");
    url.hash = "";
    return url.toString();
  } catch {
    return "";
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

export function decodeBuffer(buffer: ArrayBuffer, contentType: string) {
  const meta = new TextDecoder("ascii").decode(buffer.slice(0, 2048));
  const charset = (contentType.match(/charset=["']?([^;"'\s]+)/i)?.[1]
    ?? meta.match(/charset\s*=\s*["']?([^;"'\s/>]+)/i)?.[1])?.toLowerCase();
  const encoding = /euc|ks_c|949/.test(charset ?? "") ? "euc-kr" : "utf-8";
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

export function documentTypeFor(source: ResearchSource, title: string): MarketResearchItem["documentType"] {
  if (source.url.includes("company_list") || isStockReport(title)) return "STOCK";
  if (source.url.includes("industry_list") || /산업|업종|섹터/i.test(title)) return "INDUSTRY";
  if (source.url.includes("economy_list") || /경제|거시|매크로|macro/i.test(title)) return "MACRO";
  return "MARKET";
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
    const date = normalizeDate((row.match(/(20\d{2}[-./]\d{1,2}[-./]\d{1,2})/) ?? [])[0]);
    const pdf = (row.match(/downConfirm\('([^']+)'/i) ?? [])[1];
    const view = row.match(/view\('(\d+)','(\d+)'\)/i);
    const url = pdf
      ? absolutizeUrl(pdf, source.url)
      : view
        ? `https://securities.miraeasset.com/bbs/board/message/view.do?messageId=${view[1]}&categoryId=${view[2]}`
        : "";
    if (!url) continue;
    const text = `${title} ${date ?? ""}`;
    items.push({
      id: itemId(source.name, title, url),
      title,
      source: source.name,
      url,
      date,
      excerpt: "미래에셋증권 리서치 목록에서 추출한 최신 리포트입니다.",
      signals: inferSignals(text),
      documentType: documentTypeFor(source, title),
      broker: source.name,
      analyst: cleanText(Array.from(row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)).at(-1)?.[1] ?? "") || null,
    });
  }

  return items;
}

function extractNaverFinanceItems(html: string, source: ResearchSource): MarketResearchItem[] {
  const items: MarketResearchItem[] = [];
  // Match within a single row: the company column/NEW icon/missing PDF must not shift cells.
  for (const row of Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))) {
    const cells = Array.from(row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi), (m) => m[1]);
    const index = cells.findIndex((cell) => /_read\.naver\?/i.test(cell));
    if (index < 0) continue;
    const link = anchors(cells[index]).find((a) => /_read\.naver\?/i.test(a.href));
    if (!link) continue;
    const title = cleanText(link.text);
    const broker = cleanText(cells[index + 1] ?? '');
    const file = anchors(cells[index + 2] ?? '').find((a) => /\.pdf(?:[?#]|$)/i.test(a.href));
    const date = normalizeDate(cleanText(cells[index + 3] ?? ''));
    const url = absolutizeUrl(file?.href ?? link.href, source.url);
    if (title.length < 2 || !broker || !url || !date) continue;
    const sourceName = source.name + ' · ' + broker;
    items.push({ id: itemId(sourceName, title, url), title, source: sourceName, url, date,
      excerpt: broker + '에서 제공한 ' + source.name.replace('네이버 금융 ', '') + '입니다.',
      signals: inferSignals(title + ' ' + broker + ' ' + source.name),
      documentType: documentTypeFor(source, title), broker });
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
  // Generic sources must provide a dated article link inside a record, not navigation or JS templates.
  const body = html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
  const records = body.match(/<(?:tr|article)\b[^>]*>[\s\S]*?<\/(?:tr|article)>/gi) ?? [];
  for (const record of records) {
    const date = normalizeDate(cleanText(record));
    if (!date) continue;
    for (const a of anchors(record)) {
      const url = absolutizeUrl(a.href, source.url);
      const title = cleanText(a.text);
      if (!url || title.length < 8 || title.length > 180 || url === source.url) continue;
      if (!/\.pdf(?:\?|$)|\/analysis\/[^/?]+-\d+|[?&](?:report_idx|articleId|reportId|messageId)=/i.test(url)) continue;
      items.push({ id: itemId(source.name, title, url), title, source: source.name, url, date,
        excerpt: cleanText(record).slice(0, 180), signals: inferSignals(title), documentType: documentTypeFor(source, title) });
      break;
    }
  }
  return items;
}

function extractPublicBrokerItems(html: string, source: ResearchSource): MarketResearchItem[] {
  const items: MarketResearchItem[] = [];
  const hanyang = new URL(source.url).hostname === "www.hygood.co.kr";
  for (const row of Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))) {
    const cells = Array.from(row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi), (m) => m[1]);
    if (cells.length < 4) continue;
    const a = anchors(cells[1])[0];
    if (!a) continue;
    const title = cleanText(a.text);
    const date = normalizeDate(cleanText(cells[hanyang ? 2 : 3]));
    let url = "";
    if (hanyang && a.href.includes("/researchAnalyzeCompany/detail/")) {
      // /download is disallowed by this publisher. Return the public detail page only.
      url = absolutizeUrl(a.href, source.url);
      if (url) url = url.split("?")[0];
    } else if (!hanyang) {
      // Verified in the site's /common/js/locator.js: nav.go('view', 'key=...').
      const key = a.attributes.match(/nav\.go\('view',\s*'key=(\d+)'\)/)?.[1];
      if (key) url = new URL("view.do?key=" + key, source.url).toString();
    }
    if (!url || !date || title.length < 3) continue;
    items.push({ id: itemId(source.name, title, url), title, source: source.name, url, date,
      broker: source.name.replace(/ 리서치$/, ""), analyst: hanyang ? null : cleanText(cells[2]),
      // 흥국 목록은 산업/기업 혼합. 제목에 명확한 기업 구분("-")이 있을 때만 STOCK.
      documentType: hanyang || /[-－]/.test(title) || isStockReport(title) ? "STOCK" : "INDUSTRY",
      excerpt: source.name + " 공개 목록에서 수집한 리포트입니다.", signals: inferSignals(title) });
  }
  return items;
}

export function parseSourceItems(html: string, source: ResearchSource): MarketResearchItem[] {
  const host = new URL(source.url).hostname;
  if (host === "finance.naver.com") return extractNaverFinanceItems(html, source);
  if (host === "securities.miraeasset.com") return extractMiraeItems(html, source);
  if (host === "securities.koreainvestment.com") return extractKoreaInvestmentItems(html, source);
  if (host === "www.hanaw.com") return extractHanaItems(html, source);
  if (host === "consensus.hankyung.com") return extractHankyungItems(html, source);
  if (host === "www.hygood.co.kr" || host === "www.heungkuksec.co.kr") return extractPublicBrokerItems(html, source);
  return extractGenericItems(html, source);
}

export function nextPageUrl(html: string, currentUrl: string): string | undefined {
  const current = new URL(currentUrl);
  const host = current.hostname;
  const param = host === "finance.naver.com" ? "page"
    : host === "securities.miraeasset.com" ? "curPage"
    : host === "www.hygood.co.kr" ? "pageIndex"
    : host === "www.heungkuksec.co.kr" ? "paging.currPage" : null;
  if (!param) return undefined;
  const next = Number(current.searchParams.get(param) ?? 1) + 1;
  if (host === "www.heungkuksec.co.kr") {
    if (!new RegExp('<a\\b[^>]*\\bpage=["\']' + next + '["\']', 'i').test(html)) return undefined;
    current.searchParams.set(param, String(next));
    return current.toString();
  }
  for (const a of anchors(html)) {
    const href = absolutizeUrl(a.href, currentUrl);
    if (!href) continue;
    const target = new URL(href);
    if (target.origin === current.origin
      && target.pathname === current.pathname.replace(/;jsessionid=[^/;?]+/gi, "")
      && target.searchParams.get(param) === String(next)
      && (host !== "securities.miraeasset.com" || target.searchParams.get("categoryId") === current.searchParams.get("categoryId"))) {
      return target.toString(); // Keep the server's cursor, query and date parameters intact.
    }
  }
  return undefined;
}

const MAX_ITEMS = 30;
const PER_SOURCE_CAP = 4;

export type CrawlDateOptions = { startDate?: string; endDate?: string; now?: Date };
function dateBounds(options: CrawlDateOptions = {}) {
  const today = new Date((options.now ?? new Date()).getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
  const end = options.endDate ?? today;
  const start = options.startDate ?? new Date(Date.parse(today) - WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  if (normalizeDate(start) !== start || normalizeDate(end) !== end || start > end) throw new Error('Invalid research date range');
  return { start, end };
}

export function withinAgeFloor(item: MarketResearchItem, options: CrawlDateOptions = {}): boolean {
  if (!item.date || normalizeDate(item.date) !== item.date) return false;
  const { start, end } = dateBounds(options);
  return item.date >= start && item.date <= end;
}

export function researchIdentityKeys(item: Pick<MarketResearchItem, "url" | "source" | "title" | "date" | "broker">): string[] {
  const url = absolutizeUrl(item.url, item.url);
  const broker = (item.broker ?? item.source.split(' · ').at(-1) ?? item.source)
    .replace(/리서치|리포트|투자전략|\s/g, '').normalize('NFKC').toLowerCase();
  const title = cleanText(item.title).normalize('NFKC').replace(/\s+/g, '').toLowerCase();
  const keys: string[] = [];
  if (url) {
    const canonical = new URL(url);
    canonical.searchParams.sort();
    keys.push("url:" + canonical.toString());
  }
  if (broker && title && item.date) keys.push("report:" + broker + "|" + title + "|" + item.date);
  return keys;
}

function deduplicate(items: MarketResearchItem[]) {
  const seen = new Set<string>();
  return [...items].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).filter((item) => {
    const keys = researchIdentityKeys(item);
    // Keep legitimate repeat titles on different dates; remove the same PDF across providers.
    if (!absolutizeUrl(item.url, item.url) || keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });
}

export function uniqueLatest(items: MarketResearchItem[], options: CrawlDateOptions = {}) {
  const picked: MarketResearchItem[] = [];
  const sourceCounts = new Map<string, number>();
  for (const item of deduplicate(items.filter((it) => withinAgeFloor(it, options)))) {
    const group = item.source.split(' · ')[0];
    if ((sourceCounts.get(group) ?? 0) >= PER_SOURCE_CAP) continue;
    picked.push(item);
    sourceCounts.set(group, (sourceCounts.get(group) ?? 0) + 1);
    if (picked.length >= MAX_ITEMS) break;
  }
  return picked;
}

export function uniqueCanonical(items: MarketResearchItem[], options: CrawlDateOptions = {}) {
  return deduplicate(items.filter((it) => withinAgeFloor(it, options))).slice(0, 80);
}

const CRAWLER_AGENT = "SamsungResearchCrawler/1.0";
type RobotGroup = { agents: string[]; rules: { allow: boolean; path: string }[]; delay: number };

export function robotsPolicy(text: string, url: string, agent = CRAWLER_AGENT): { allowed: boolean; delayMs: number } {
  const groups: RobotGroup[] = [];
  let group: RobotGroup | undefined;
  let rulesStarted = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    const match = line.match(/^([\w-]+)\s*:\s*(.*)$/);
    if (!match) continue;
    const key = match[1].toLowerCase(), value = match[2].trim();
    if (key === 'user-agent') {
      if (!group || rulesStarted) { group = { agents: [], rules: [], delay: 0 }; groups.push(group); rulesStarted = false; }
      group.agents.push(value.toLowerCase());
    } else if (group && (key === 'allow' || key === 'disallow')) {
      rulesStarted = true;
      if (value) group.rules.push({ allow: key === 'allow', path: value });
    } else if (group && key === 'crawl-delay') {
      rulesStarted = true;
      if (Number.isFinite(Number(value))) group.delay = Math.max(group.delay, Number(value) * 1000);
    }
  }
  const target = new URL(url);
  const path = target.pathname + target.search;
  const policyFor = (identity: string) => {
    const specific = groups.filter((g) => g.agents.some((a) => a !== '*' && identity.toLowerCase().includes(a)));
    const selected = specific.length ? specific : groups.filter((g) => g.agents.includes('*'));
    let specificity = -1, allowed = true, delayMs = 0;
    for (const g of selected) {
      delayMs = Math.max(delayMs, g.delay);
      for (const rule of g.rules) {
        const terminal = rule.path.endsWith('$');
        const pattern = (terminal ? rule.path.slice(0, -1) : rule.path).split('*')
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
        if (!new RegExp('^' + pattern + (terminal ? '$' : '')).test(path)) continue;
        const length = rule.path.replace(/[*$]/g, '').length;
        if (length > specificity || (length === specificity && rule.allow)) {
          allowed = rule.allow; specificity = length;
        }
      }
    }
    return { allowed, delayMs };
  };
  const own = policyFor(agent);
  // Also honor explicit AI-collection exclusions; never masquerade as an allowed search bot.
  const ai = policyFor('GPTBot');
  return { allowed: own.allowed && ai.allowed, delayMs: Math.max(own.delayMs, ai.delayMs) };
}

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export function createCrawlClient(fetcher: Fetcher = (url, init) => fetch(url, init), intervalMs = 400) {
  const policies = new Map<string, { expires: number; value: Promise<string> }>();
  const queues = new Map<string, Promise<void>>();
  const lastRequest = new Map<string, number>();
  async function request(url: string, delayMs = intervalMs) {
    const origin = new URL(url).origin;
    const prior = queues.get(origin) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tail = prior.then(() => gate);
    queues.set(origin, tail);
    await prior;
    try {
      const wait = Math.max(0, delayMs - (Date.now() - (lastRequest.get(origin) ?? 0)));
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      lastRequest.set(origin, Date.now());
      const response = await fetcher(url, { cache: 'no-store', redirect: 'manual',
        headers: { 'user-agent': CRAWLER_AGENT, accept: 'text/html,application/pdf,text/plain;q=0.9,*/*;q=0.8' },
        signal: AbortSignal.timeout(8_000) });
      // Consume the body under the same timeout and domain queue.
      return { response, buffer: await response.arrayBuffer() };
    } finally {
      release();
      if (queues.get(origin) === tail) queues.delete(origin);
    }
  }
  async function policy(url: string) {
    const origin = new URL(url).origin;
    let cached = policies.get(origin);
    if (!cached || cached.expires <= Date.now()) {
      const value = (async () => {
        const { response, buffer } = await request(origin + '/robots.txt');
        if (response.status === 404 || response.status === 410) return '';
        if (!response.ok) throw new Error('robots unavailable: HTTP ' + response.status);
        const text = decodeBuffer(buffer, response.headers.get('content-type') ?? '');
        // A 200 HTML error/login page is not a usable robots policy.
        if (/<(?:html|body|!doctype)\b/i.test(text)) throw new Error('robots unavailable: HTML response');
        return text;
      })();
      cached = { expires: Date.now() + 60 * 60_000, value };
      policies.set(origin, cached);
      value.catch(() => { if (policies.get(origin)?.value === value) policies.delete(origin); });
    }
    return robotsPolicy(await cached.value, url);
  }
  return {
    policy,
    async get(url: string) {
      let current = url;
      for (let redirects = 0; redirects <= 3; redirects++) {
        const rule = await policy(current);
        if (!rule.allowed) throw new Error('robots disallowed');
        if (rule.delayMs > 10_000) throw new Error('crawl-delay exceeds interactive collection budget');
        const { response, buffer } = await request(current, Math.max(intervalMs, rule.delayMs));
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const next = absolutizeUrl(response.headers.get('location') ?? '', current);
          if (!next) throw new Error('invalid redirect');
          current = next;
          continue;
        }
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return { url: current, status: response.status, contentType: response.headers.get('content-type') ?? '', buffer };
      }
      throw new Error('too many redirects');
    },
  };
}

const crawlClient = createCrawlClient();
export type CrawlEvent = { source: string; status: 'page' | 'failed' | 'partial'; page: number; count: number; message?: string; url?: string };
type CrawlOptions = CrawlDateOptions & {
  maxPages?: number;
  client?: ReturnType<typeof createCrawlClient>;
  onEvent?: (event: CrawlEvent) => void;
};

export async function fetchSource(source: ResearchSource, options: CrawlOptions = {}): Promise<MarketResearchItem[]> {
  const client = options.client ?? crawlClient;
  const { start } = dateBounds(options);
  const maxPages = Math.max(1, Math.min(options.maxPages ?? 4, 10));
  const deadline = Date.now() + 25_000;
  const items: MarketResearchItem[] = [];
  const seen = new Set<string>();
  let url: string | undefined = source.url;
  let page = 0;
  const emit = (event: CrawlEvent) => {
    options.onEvent?.(event);
    if (event.status !== 'page') console.warn('[research crawler] ' + source.name + ': ' + event.message);
  };
  try {
    while (url && page < maxPages && Date.now() < deadline) {
      const result = await client.get(url);
      const html = decodeBuffer(result.buffer, result.contentType);
      const found = parseSourceItems(html, { ...source, url: result.url });
      page++;
      const fresh = found.filter((item) => {
        if (seen.has(item.url)) return false;
        seen.add(item.url); return true;
      });
      items.push(...fresh);
      emit({ source: source.name, status: 'page', page, count: found.length, url: result.url });
      if (!fresh.length) {
        if (!found.length) emit({ source: source.name, status: page === 1 ? 'failed' : 'partial', page, count: items.length,
          message: 'no dated report records (empty list, rendering, or parser change)' });
        break;
      }
      if (found.every((item) => item.date && item.date < start)) { url = undefined; break; }
      url = nextPageUrl(html, result.url);
    }
    if (url && (page >= maxPages || Date.now() >= deadline)) {
      emit({ source: source.name, status: 'partial', page, count: items.length, message: 'bounded pagination limit reached' });
    }
  } catch (error) {
    emit({ source: source.name, status: items.length ? 'partial' : 'failed', page, count: items.length,
      message: error instanceof Error ? error.message : 'request failed' });
  }
  // Preserve earlier pages even when a later page or another source fails.
  return items.filter((item) => withinAgeFloor(item, options));
}
