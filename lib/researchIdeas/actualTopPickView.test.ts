import test from 'node:test';
import assert from 'node:assert/strict';
import { actualCounts, buildActualTopPickView, filterActualTopPicks, getActualSourceHref, parseActualTopPickQuery, validActualDate, type ActualReport, type ActualPick } from './actualTopPickView';

const window = { start: '2026-08-08', end: '2026-09-08' };
const report = (extra: Partial<ActualReport> = {}): ActualReport => ({ id: 'synthetic-report', title: '합성 선정 표', institution: '합성 국내 기관', institutionGroup: 'domestic_other', desk: '합성 데스크', authors: ['합성 작성자'], publishedOn: '2026-08-08', verifiedAt: '2026-09-08T00:00:00Z', sourceHash: null, sourceUrl: 'https://file.hanaw.com/synthetic-not-fetched.pdf', sourceKind: 'pdf', rightsStatus: 'unconfirmed', ...extra });
const pick = (extra: Partial<ActualPick> = {}): ActualPick => ({ id: 'synthetic-pick', reportId: 'synthetic-report', name: '가상기업', code: 'FAKE', securityMarket: '합성시장', kind: 'stock', horizons: ['unknown'], horizonBasis: '기간 명시 없음', sector: null, selectionLabel: 'Top Picks', selectionEvidence: 'explicit_top_pick', evidence: '합성 선정 표의 가상 기록', page: 2, locator: '합성 표 1행', ...extra });
const fixture = () => buildActualTopPickView([report()], [pick()], window);

test('actual review flags do not claim automation, database or publication rights', () => {
  const view = fixture(); assert.equal(view.rows.length, 1); assert.deepEqual(view.withheld, []);
  assert.equal(view.mode, 'actual_review'); assert.equal(view.publicRelease, false); assert.equal(view.automatedCollection, false); assert.equal(view.databaseConnected, false);
  assert.equal(view.reports[0].sourceHash, null); assert.equal(view.reports[0].rightsStatus, 'unconfirmed');
});
test('both publication-window boundaries are included and out-of-range dates are withheld', () => {
  for (const date of ['2026-08-08', '2026-09-08']) assert.equal(buildActualTopPickView([report({ publishedOn: date })], [pick()], window).rows.length, 1);
  for (const date of ['2026-08-07', '2026-09-09', '2026-02-30', '']) assert.equal(buildActualTopPickView([report({ publishedOn: date })], [pick()], window).rows.length, 0);
  assert.equal(validActualDate('2026-02-30'), false);
  assert.equal(buildActualTopPickView([report()], [pick()], { start: window.end, end: window.start }).rows.length, 0);
});
test('only explicit selection is accepted; BUY/watchlist classification is not promoted', () => {
  for (const value of ['buy', 'watchlist', 'mention', undefined]) {
    const bad = { ...pick(), selectionEvidence: value } as unknown as ActualPick;
    assert.equal(buildActualTopPickView([report()], [bad], window).rows.length, 0);
  }
  for (const selectionLabel of ['BUY', '매수', '관심종목', 'Watch list', '단순 언급']) assert.equal(buildActualTopPickView([report()], [pick({ selectionLabel })], window).rows.length, 0);
});
test('institution domicile is separate from the security market and ETF kind', () => {
  const view = buildActualTopPickView([report()], [pick({ kind: 'etf', securityMarket: 'US' })], window);
  assert.equal(filterActualTopPicks(view, parseActualTopPickQuery('institutionGroup=domestic_other&kind=etf')).length, 1);
  assert.equal(filterActualTopPicks(view, parseActualTopPickQuery('institutionGroup=foreign')).length, 0);
  assert.equal(filterActualTopPicks(view, parseActualTopPickQuery('kind=stock')).length, 0);
});
test('explicit dual horizons are preserved; unknown is never inferred or mixed', () => {
  const view = buildActualTopPickView([report()], [pick({ horizons: ['short', 'medium-long'], horizonBasis: '합성 원문에서 두 기간 명시' })], window);
  for (const horizon of ['short', 'medium-long']) assert.equal(filterActualTopPicks(view, parseActualTopPickQuery('horizon=' + horizon)).length, 1);
  assert.equal(filterActualTopPicks(fixture(), parseActualTopPickQuery('horizon=short')).length, 0);
  for (const horizons of [['unknown', 'short'], [], ['short', 'short'], ['invented']]) assert.equal(buildActualTopPickView([report()], [pick({ horizons: horizons as ActualPick['horizons'] })], window).rows.length, 0);
});
test('sector filter uses only provided original classifications, including unknown', () => {
  const view = buildActualTopPickView([report()], [pick({ sector: '합성업종' })], window);
  assert.deepEqual(view.sectors, ['합성업종']);
  assert.equal(filterActualTopPicks(view, parseActualTopPickQuery('sector=' + encodeURIComponent('합성업종'), view.sectors)).length, 1);
  assert.equal(parseActualTopPickQuery('sector=Invented', view.sectors).status, 'invalid');
  assert.equal(filterActualTopPicks(fixture(), parseActualTopPickQuery('sector=unknown')).length, 1);
});
test('repeated symbols retain document evidence while display-name counts deduplicate', () => {
  const view = buildActualTopPickView([report(), report({ id: 'report-b', publishedOn: '2026-08-09' })], [pick(), pick({ id: 'pick-b', reportId: 'report-b' })], window);
  assert.deepEqual(actualCounts(view.rows), { records: 2, reports: 2, securities: 1 });
  assert.equal(buildActualTopPickView([report()], [pick(), pick()], window).rows.length, 1);
  assert.ok(buildActualTopPickView([report(), report()], [pick()], window).withheld.length > 0);
});
test('withdrawal and conflicting evidence remain visible instead of last-write-wins', () => {
  const view = buildActualTopPickView([report({ warnings: ['합성 원문 편집 불일치'] })], [pick({ status: 'withdrawn_later', warnings: ['합성 후속 기록에서 철회'] })], window);
  assert.equal(view.rows[0].pick.status, 'withdrawn_later');
  assert.deepEqual(view.rows[0].pick.warnings, ['합성 후속 기록에서 철회']);
  assert.deepEqual(view.rows[0].report.warnings, ['합성 원문 편집 불일치']);
});
test('strict source allowlist rejects unsafe URLs; only PDFs receive page anchors', () => {
  assert.equal(getActualSourceHref(report(), 2), 'https://file.hanaw.com/synthetic-not-fetched.pdf#page=2');
  const html = report({ sourceKind: 'html', sourceUrl: 'https://www.kgieworld.sg/research/synthetic-not-fetched/' });
  assert.equal(getActualSourceHref(html, 2), html.sourceUrl);
  for (const url of ['http://file.hanaw.com/a.pdf', 'https://file.hanaw.com.evil.test/a.pdf', 'https://user@file.hanaw.com/a.pdf', 'https://file.hanaw.com:443/a.pdf', 'https://127.0.0.1/a.pdf', 'javascript:alert(1)', 'https://file.hanaw.com/a.pdf#page=2', 'https://file.hanaw.com\\@evil.test/a']) assert.equal(getActualSourceHref(report({ sourceUrl: url }), 1), null, url);
  for (const page of [0, -1, 1.5, 10001]) assert.equal(getActualSourceHref(report(), page), null);
});
test('unknown, duplicate and malformed query input is fail-closed', () => {
  const bad: unknown[] = ['horizon=short&horizon=unknown', 'kind=stock&kind=etf', 'customerId=x', 'q=%GG', 'q=%00', { q: ['one', 'two'] }, { q: 'x'.repeat(101) }, null, [], 3];
  for (const input of bad) {
    const query = parseActualTopPickQuery(input as Parameters<typeof parseActualTopPickQuery>[0]);
    assert.equal(query.status, 'invalid', JSON.stringify(input)); assert.deepEqual(filterActualTopPicks(fixture(), query), []);
  }
  let reads = 0; const getter = Object.defineProperty({}, 'q', { enumerable: true, get() { reads++; return 'bad'; } });
  assert.equal(parseActualTopPickQuery(getter).status, 'invalid'); assert.equal(reads, 0);
});
test('forged filters are revalidated and search syntax remains inert literal text', () => {
  const query = parseActualTopPickQuery('');
  assert.deepEqual(filterActualTopPicks(fixture(), { ...query, filters: { ...query.filters, kind: 'invented' } as unknown as typeof query.filters }), []);
  for (const text of ['<img src=x onerror=alert(1)>', '.*', 'javascript:alert(1)']) {
    const q = parseActualTopPickQuery({ q: text }); assert.equal(q.status, 'valid'); assert.deepEqual(filterActualTopPicks(fixture(), q), []);
  }
  assert.equal(filterActualTopPicks(fixture(), parseActualTopPickQuery({ q: ' fake ' })).length, 1);
});
