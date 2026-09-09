import test from 'node:test';
import assert from 'node:assert/strict';
import { absolutizeUrl, createCrawlClient, decodeBuffer, fetchSource, nextPageUrl, normalizeDate,
  parseSourceItems, robotsPolicy, uniqueCanonical, uniqueLatest, withinAgeFloor } from './researchCrawler';
import type { MarketResearchItem, ResearchSource } from './portfolioResearch';

const naver: ResearchSource = { name: '네이버 금융 기업분석 리포트', url: 'https://finance.naver.com/research/company_list.naver', category: 'report' };
const mirae: ResearchSource = { name: '미래에셋증권 리서치', url: 'https://securities.miraeasset.com/bbs/board/message/list.do?categoryId=1521', category: 'report' };
const now = new Date('2026-09-09T16:00:00Z'); // 9/10 KST
function naverRow(id = '1', date = '26.09.09', pdf = true) {
  return `<tr><td><a href='/item/main.naver?code=005930'>삼성전자</a></td>
    <td class='title'><a class='report' href='company_read.naver?nid=${id}&amp;page=1'>반도체 실적 전망 ${id}</a><img alt='NEW'></td>
    <td class='broker'>테스트증권</td><td class='file'>${pdf ? `<a target='_blank' href='/reports/${id}.pdf?download=1&amp;lang=ko'>PDF</a>` : ''}</td>
    <td class='date'>${date}</td><td>12345</td></tr>`;
}
function item(overrides: Partial<MarketResearchItem> = {}): MarketResearchItem {
  return { id: 'id', title: '반도체 실적 전망', broker: '테스트증권', source: '테스트증권 리서치',
    url: 'https://example.com/report.pdf', date: '2026-09-09', signals: [], ...overrides };
}

// Synthetic parser fixtures only: NAVER currently disallows live crawling.
test('NAVER company column, reordered attributes, NEW badge and PDF query are parsed per row', () => {
  const [result] = parseSourceItems(naverRow(), naver);
  assert.equal(result.title, '반도체 실적 전망 1');
  assert.equal(result.broker, '테스트증권');
  assert.equal(result.documentType, 'STOCK');
  assert.equal(result.date, '2026-09-09');
  assert.equal(result.url, 'https://finance.naver.com/reports/1.pdf?download=1&lang=ko');
});

test('NAVER missing PDF never captures the next report; industry category survives', () => {
  const source = { ...naver, url: naver.url.replace('company_list', 'industry_list') };
  const result = parseSourceItems(naverRow('1', '26.09.09', false) + naverRow('2'), source);
  assert.equal(result.length, 2);
  assert.match(result[0].url, /company_read\.naver\?nid=1&page=1$/);
  assert.equal(result[0].documentType, 'INDUSTRY');
  assert.match(result[1].url, /2\.pdf/);
});

test('NAVER malformed row does not steal metadata from the following row', () => {
  const bad = `<tr><td><a href='company_read.naver?nid=0'>불완전한 리포트</a></td></tr>`;
  assert.equal(parseSourceItems(bad + naverRow(), naver).length, 1);
});

test('Mirae keeps stock reports for canonical ingestion and preserves PDF download parameters', () => {
  const html = `<tr><td>2026-09-09</td><td><div class="subject"><a href="javascript:view('11','22')">삼성전자 (005930/매수)<br>실적 개선</a></div></td>
    <td><a href="javascript:downConfirm('/bbs/download/a.pdf?attachmentId=42&amp;x=1')">PDF</a></td><td>김연구</td></tr>`;
  const [result] = parseSourceItems(html, mirae);
  assert.equal(result.documentType, 'STOCK');
  assert.equal(result.url, 'https://securities.miraeasset.com/bbs/download/a.pdf?attachmentId=42&x=1');
  assert.equal(result.title, '삼성전자 (005930/매수) 실적 개선');
  assert.equal(result.analyst, '김연구');
});

test('invalid calendar dates and future dates are not recent data; KST date boundary is inclusive', () => {
  assert.equal(normalizeDate('2026-02-30'), undefined);
  assert.equal(normalizeDate('2024/2/29'), '2024-02-29');
  assert.equal(normalizeDate('26.09.09'), '2026-09-09');
  assert.equal(normalizeDate('20260909'), '2026-09-09');
  assert.equal(withinAgeFloor(item({ date: '2026-09-10' }), { now }), true);
  assert.equal(withinAgeFloor(item({ date: '2026-09-11' }), { now }), false);
  assert.equal(withinAgeFloor(item({ date: '2026-08-10' }), { now }), false);
  assert.equal(withinAgeFloor(item({ date: undefined }), { now }), false);
  assert.equal(withinAgeFloor(item(), { now, startDate: '2026-09-09', endDate: '2026-09-09' }), true);
});

test('date options reject invalid or reversed ranges', () => {
  assert.throws(() => withinAgeFloor(item(), { startDate: '2026-09-11', endDate: '2026-09-09' }));
  assert.throws(() => withinAgeFloor(item(), { startDate: '2026-02-30' }));
});

test('relative URLs preserve query, strip ephemeral session IDs and reject non-HTTP links', () => {
  assert.equal(absolutizeUrl('../a.pdf?x=1&amp;y=2', 'https://example.com/research/list'), 'https://example.com/a.pdf?x=1&y=2');
  assert.equal(absolutizeUrl('/detail/1;jsessionid=ABC?key=2', 'https://example.com'), 'https://example.com/detail/1?key=2');
  for (const href of ['#', 'javascript:void(0)', 'mailto:research@example.com', 'data:text/plain,test']) assert.equal(absolutizeUrl(href, naver.url), '');
});

test('HTML meta charset handles EUC-KR when HTTP header omits it', () => {
  const prefix = new TextEncoder().encode('<meta charset="euc-kr">');
  const buffer = new Uint8Array([...Array.from(prefix), 0xb0, 0xa1]).buffer;
  assert.equal(decodeBuffer(buffer, 'text/html'), '<meta charset="euc-kr">가');
});

test('NAVER pagination follows discovered same-path next links only', () => {
  const html = `<a href='company_list.naver?page=3'>3</a><a href='company_list.naver?page=2&amp;type=all'>2</a>`;
  assert.equal(nextPageUrl(html, naver.url), naver.url + '?page=2&type=all');
  assert.equal(nextPageUrl(`<a href='https://evil.test/research/company_list.naver?page=2'>2</a>`, naver.url), undefined);
  assert.equal(nextPageUrl(`<a href='industry_list.naver?page=2'>2</a>`, naver.url), undefined);
});

test('Mirae cursor and Hanyang/Heungkuk pagination contracts are preserved', () => {
  assert.equal(nextPageUrl(`<a href='list.do?categoryId=1521&amp;curPage=2&amp;startId=abc~&amp;direction=1'>2</a>`, mirae.url), mirae.url + '&curPage=2&startId=abc~&direction=1');
  const hy = 'https://www.hygood.co.kr/board/researchAnalyzeCompany/list';
  assert.equal(nextPageUrl(`<a href='/board/researchAnalyzeCompany/list;jsessionid=ABC?pageIndex=2&pageSize=10'>2</a>`, hy), hy + '?pageIndex=2&pageSize=10');
  const hk = 'https://www.heungkuksec.co.kr/research/company/list.do?key=300';
  assert.equal(nextPageUrl(`<a page="2">2</a>`, hk), hk + '&paging.currPage=2');
});

test('dedupe joins portal and broker copies but preserves daily repeat titles and different brokers', () => {
  const rows = [item(), item({ source: '네이버 금융 산업분석 · 테스트증권', url: 'https://portal.example/report.pdf' }),
    item({ id: 'next', date: '2026-09-08', url: 'https://example.com/yesterday.pdf' }),
    item({ id: 'other', broker: '다른증권', url: 'https://other.example/report.pdf' }),
    item({ id: 'same-pdf', title: '다른 표기', source: '다른 소스' })];
  assert.equal(uniqueCanonical(rows, { now }).length, 3);
  assert.equal(uniqueLatest(rows, { now }).length, 3);
});

test('selection retains existing 30 total / 4 per source and canonical 80 caps; never adds fallback', () => {
  const rows = Array.from({ length: 100 }, (_, i) => item({ id: String(i), title: '보고서 ' + i, url: 'https://example.com/' + i, source: '소스' + Math.floor(i / 10) }));
  const picked = uniqueLatest(rows, { now });
  assert.equal(picked.length, 30);
  assert.ok(picked.filter((it) => it.source === '소스0').length <= 4);
  assert.equal(uniqueCanonical(rows, { now }).length, 80);
  assert.deepEqual(uniqueLatest([], { now }), []);
});

test('generic crawler rejects menus and inline JS templates even if nearby dates exist', () => {
  const html = `<script>var html='<tr><td>2026-09-09</td><td><a href="/analysis/test-123">시장 전망 가짜 템플릿</a></td></tr>';</script>
    <nav><a href='/research'>시장 투자전략 리포트</a>2026-09-09</nav>
    <tr><td>2026-09-09</td><td><a href='javascript:login()'>PDF 리포트 다운로드</a></td></tr>`;
  assert.deepEqual(parseSourceItems(html, { name: 'KB증권', url: 'https://www.kbsec.com/go.able', category: 'report' }), []);
});

test('broker parsers keep analyst and stable detail URLs; Hanyang download is never returned', () => {
  const hk = { name: '흥국증권 리서치', url: 'https://www.heungkuksec.co.kr/research/company/list.do?key=300', category: 'report' as const };
  const [a] = parseSourceItems(`<tr><td>1</td><td><a href="#" onclick="nav.go('view', 'key=21');">테스트기업-실적 개선</a></td><td>김연구</td><td>2026-09-09</td></tr>`, hk);
  assert.equal(a.analyst, '김연구'); assert.equal(a.url, 'https://www.heungkuksec.co.kr/research/company/view.do?key=21');
  const hy = { ...hk, name: '한양증권 리서치', url: 'https://www.hygood.co.kr/board/researchAnalyzeCompany/list' };
  const [b] = parseSourceItems(`<tr><td>1</td><td><a href='/board/researchAnalyzeCompany/detail/21;jsessionid=A?pageIndex=1'>기업(005930) 전망</a></td><td>2026.09.09</td><td><a href='/download?id=1'>PDF</a></td></tr>`, hy);
  assert.equal(b.url, 'https://www.hygood.co.kr/board/researchAnalyzeCompany/detail/21');
});

test('robots wildcard denies NAVER without borrowing the Yeti allowance', () => {
  const rules = 'User-agent: *\nDisallow: /\nUser-agent: Yeti\nAllow: /research/';
  assert.equal(robotsPolicy(rules, naver.url).allowed, false);
  assert.equal(robotsPolicy('User-agent: Yeti\nAllow: /', mirae.url).allowed, true);
});

test('robots supports spaced directives, query wildcards, allow precedence and crawl delay', () => {
  const rules = 'User-Agent : *\nDisallow : /download\nAllow: /download/public\nDisallow: /*?secret=*\nCrawl-delay: 2';
  assert.equal(robotsPolicy(rules, 'https://example.com/download?id=2').allowed, false);
  assert.equal(robotsPolicy(rules, 'https://example.com/download/public/a.pdf').allowed, true);
  assert.equal(robotsPolicy(rules, 'https://example.com/a?secret=1').allowed, false);
  assert.equal(robotsPolicy(rules, 'https://example.com/list').delayMs, 2000);
  assert.equal(robotsPolicy('User-agent: GPTBot\nDisallow: /\nUser-agent: *\nAllow: /', 'https://example.com/list').allowed, false);
});

test('blocked robots never requests report pages and failures do not reject the collection', async () => {
  const calls: string[] = [];
  const client = createCrawlClient(async (url) => { calls.push(url); return new Response('User-agent: *\nDisallow: /'); }, 0);
  assert.deepEqual(await fetchSource(naver, { client, now }), []);
  assert.deepEqual(calls, ['https://finance.naver.com/robots.txt']);
});

test('crawler preserves earlier pages when next page fails; another source still succeeds', async () => {
  const client = createCrawlClient(async (url) => {
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    if (url.includes('page=2')) return new Response('unavailable', { status: 503 });
    return new Response(naverRow() + `<a href='company_list.naver?page=2'>2</a>`);
  }, 0);
  const events: string[] = [];
  const result = await fetchSource(naver, { client, now, onEvent: (event) => events.push(event.status) });
  assert.equal(result.length, 1); assert.ok(events.includes('partial'));
  const good = await fetchSource({ ...naver, url: naver.url + '?other=1' }, { client, now, maxPages: 1 });
  assert.equal(good.length, 1);
});

test('pagination visits later pages, filters bounds and stops on an old page', async () => {
  const calls: string[] = [];
  const client = createCrawlClient(async (url) => {
    calls.push(url);
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
    const page = Number(new URL(url).searchParams.get('page') ?? 1);
    return new Response(naverRow(String(page), page === 3 ? '26.07.01' : '26.09.09') + `<a href='company_list.naver?page=${page + 1}'>next</a>`);
  }, 0);
  const result = await fetchSource(naver, { client, now });
  assert.equal(result.length, 2); assert.equal(calls.length, 4);
  assert.ok(!calls.some((url) => url.includes('page=4')));
});

test('repeated pages stop; same-domain calls share a robots fetch and preserve explicit request timeout', async () => {
  const calls: string[] = [];
  const client = createCrawlClient(async (url, init) => {
    calls.push(url); assert.ok(init?.signal); assert.equal(init?.redirect, 'manual');
    if (url.endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
    return new Response(naverRow() + `<a href='company_list.naver?page=2'>2</a><a href='company_list.naver?page=3'>3</a>`);
  }, 0);
  const result = await fetchSource(naver, { client, now });
  assert.equal(result.length, 1); assert.equal(calls.length, 3);
});

test('redirect destination is checked against its own policy before being requested', async () => {
  const calls: string[] = [];
  const client = createCrawlClient(async (url) => {
    calls.push(url);
    if (url === 'https://blocked.test/robots.txt') return new Response('User-agent: *\nDisallow: /');
    if (url.endsWith('/robots.txt')) return new Response('', { status: 404 });
    return new Response('', { status: 302, headers: { location: 'https://blocked.test/report.pdf' } });
  }, 0);
  await assert.rejects(client.get('https://allowed.test/report.pdf'), /robots disallowed/);
  assert.ok(!calls.includes('https://blocked.test/report.pdf'));
});

test('robots HTTP failure or HTML error page cannot silently enable crawling', async () => {
  for (const response of [new Response('error', { status: 503 }), new Response('<html>error</html>')]) {
    const client = createCrawlClient(async () => response, 0);
    await assert.rejects(client.get('https://example.com/list'), /robots unavailable/);
  }
});
