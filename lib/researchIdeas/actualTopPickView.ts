/** Browser-safe facts/view contract. No fetching, credentials, database or approval mutation. */
export type InstitutionGroup = 'samsung' | 'domestic_other' | 'foreign';
export type AssetKind = 'stock' | 'etf';
export type Horizon = 'short' | 'medium-long' | 'unknown';
export type ActualReport = {
  id: string; title: string; institution: string; institutionGroup: InstitutionGroup;
  desk: string; authors: string[]; publishedOn: string; verifiedAt: string; sourceHash: string | null;
  sourceUrl: string; sourceKind: 'pdf' | 'html'; rightsStatus: 'unconfirmed'; accessNote?: string; warnings?: string[];
};
export type ActualPick = {
  id: string; reportId: string; name: string; code: string | null; securityMarket: string | null;
  kind: AssetKind; horizons: Horizon[]; horizonBasis: string; sector: string | null;
  selectionLabel: string; selectionEvidence: 'explicit_top_pick'; evidence: string; page: number | null; locator: string;
  status?: 'recorded' | 'withdrawn_later' | 'conflicting'; warnings?: string[];
};
export type ActualRow = { pick: ActualPick; report: ActualReport };
export type ActualTopPickView = {
  mode: 'actual_review'; publicRelease: false; automatedCollection: false; databaseConnected: false;
  window: { start: string; end: string }; reports: ActualReport[]; rows: ActualRow[];
  withheld: string[]; sectors: string[];
};
export const INSTITUTION_LABELS: Record<InstitutionGroup, string> = { samsung: '삼성증권', domestic_other: '기타 국내 기관', foreign: '해외 기관' };
export const HORIZON_LABELS: Record<Horizon, string> = { short: '단기', 'medium-long': '중장기', unknown: '기간 미확인' };
const HOSTS = ['www.samsungpop.com', 'bbs2.shinhansec.com', 'file.hanaw.com', 'rdata.kbsec.com', 'www.kgieworld.sg', 'simplehai.axisdirect.in'];
const GROUPS: readonly string[] = ['samsung', 'domestic_other', 'foreign'];
const HORIZONS: readonly string[] = ['short', 'medium-long', 'unknown'];
const text = (v: unknown, max = 1000): v is string => typeof v === 'string' && /\S/.test(v) && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v);
const nullableText = (v: unknown, max = 100): v is string | null => v === null || text(v, max);
const warningsValid = (v: unknown) => v === undefined || (Array.isArray(v) && v.length <= 20 && v.every(w => text(w, 2000)));
export function validActualDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
/** A link allowlist is not a grant to copy, extract, store or redistribute a report. */
export function getActualSourceHref(report: Pick<ActualReport, 'sourceUrl' | 'sourceKind'>, page: number | null = null): string | null {
  try {
    const raw = report.sourceUrl;
    if (!text(raw, 2500) || raw !== raw.trim() || /[\\\s]/.test(raw) || raw.includes('#')) return null;
    const authority = raw.match(/^https:\/\/([^/?#]+)/)?.[1];
    if (!authority || authority.includes(':') || authority.includes('@')) return null;
    const url = new URL(raw);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !HOSTS.includes(url.hostname)) return null;
    if (!['pdf', 'html'].includes(report.sourceKind)) return null;
    if (page !== null && (!Number.isSafeInteger(page) || page < 1 || page > 10000)) return null;
    if (report.sourceKind === 'pdf' && page !== null) url.hash = 'page=' + page;
    return url.href;
  } catch { return null; }
}
function validReport(r: ActualReport): boolean {
  return !!r && ['id', 'title', 'institution', 'desk'].every(k => text(r[k as 'id'], 1000))
    && GROUPS.includes(r.institutionGroup) && Array.isArray(r.authors) && r.authors.length <= 30 && r.authors.every(a => text(a, 200))
    && validActualDate(r.publishedOn) && typeof r.verifiedAt === 'string'
    && /^\d{4}-\d{2}-\d{2}T/.test(r.verifiedAt) && Number.isFinite(Date.parse(r.verifiedAt))
    && validActualDate(r.verifiedAt.slice(0, 10))
    && (r.sourceHash === null || (typeof r.sourceHash === 'string' && /^[0-9a-f]{64}$/i.test(r.sourceHash)))
    && r.rightsStatus === 'unconfirmed' && getActualSourceHref(r) !== null
    && (r.accessNote === undefined || text(r.accessNote, 2000)) && warningsValid(r.warnings);
}
function validPick(p: ActualPick): boolean {
  return !!p && ['id', 'reportId', 'name', 'horizonBasis', 'selectionLabel', 'evidence', 'locator'].every(k => text(p[k as 'id'], 2000))
    && nullableText(p.code) && nullableText(p.securityMarket) && nullableText(p.sector)
    && ['stock', 'etf'].includes(p.kind) && p.selectionEvidence === 'explicit_top_pick'
    && !/^(?:buy|매수|매수\s*의견|관심\s*(?:종목)?|watch\s*list|단순\s*언급)$/i.test(p.selectionLabel.trim())
    && Array.isArray(p.horizons) && p.horizons.length > 0 && p.horizons.length <= 2
    && p.horizons.every(h => HORIZONS.includes(h)) && new Set(p.horizons).size === p.horizons.length
    && !(p.horizons.includes('unknown') && p.horizons.length !== 1)
    && (p.page === null || (Number.isSafeInteger(p.page) && p.page > 0 && p.page <= 10000))
    && (p.status === undefined || ['recorded', 'withdrawn_later', 'conflicting'].includes(p.status)) && warningsValid(p.warnings);
}
export function buildActualTopPickView(reports: readonly ActualReport[], picks: readonly ActualPick[], window: { start: string; end: string }): ActualTopPickView {
  const result: ActualTopPickView = { mode: 'actual_review', publicRelease: false, automatedCollection: false, databaseConnected: false, window: { ...window }, reports: [], rows: [], withheld: [], sectors: [] };
  if (!validActualDate(window.start) || !validActualDate(window.end) || window.start > window.end || !Array.isArray(reports) || !Array.isArray(picks) || reports.length > 200 || picks.length > 1000) {
    result.withheld.push('기간 또는 자료 형식이 잘못되어 전체 표시를 보류했습니다.'); return result;
  }
  const reportIds = new Set<string>(), pickIds = new Set<string>();
  for (const r of reports) {
    if (!validReport(r) || reportIds.has(r.id)) { result.withheld.push('원문 메타데이터·링크 또는 보고서 ID 중복을 확인해 주세요.'); continue; }
    reportIds.add(r.id);
    if (r.publishedOn < window.start || r.publishedOn > window.end) { result.withheld.push(`${r.title}: 발행일이 고정 조회 기간 밖입니다.`); continue; }
    result.reports.push({ ...r, authors: r.authors.slice(), warnings: r.warnings?.slice() });
  }
  const byId = new Map(result.reports.map(r => [r.id, r]));
  for (const p of picks) {
    if (!validPick(p) || pickIds.has(p.id)) { result.withheld.push('명시 선정·기간·종류 또는 선정 기록 ID 중복을 확인해 주세요.'); continue; }
    pickIds.add(p.id);
    const report = byId.get(p.reportId);
    if (!report) { result.withheld.push(`${p.name}: 기간 내 유효한 원문 연결이 없습니다.`); continue; }
    result.rows.push({ pick: { ...p, horizons: p.horizons.slice(), warnings: p.warnings?.slice() }, report });
  }
  result.rows.sort((a, b) => b.report.publishedOn.localeCompare(a.report.publishedOn) || a.pick.name.localeCompare(b.pick.name));
  result.sectors = Array.from(new Set(result.rows.map(row => row.pick.sector).filter((v): v is string => v !== null))).sort();
  return result;
}
export type ActualFilters = { q: string; institutionGroup: 'all' | InstitutionGroup; kind: 'all' | AssetKind; horizon: 'all' | Horizon; sector: string };
export type ActualQuery = { status: 'valid' | 'invalid'; filters: ActualFilters; errors: string[] };
export type ActualQueryInput = string | URLSearchParams | Readonly<Record<string, string | string[] | undefined>>;
const defaults = (): ActualFilters => ({ q: '', institutionGroup: 'all', kind: 'all', horizon: 'all', sector: 'all' });
const QUERY_KEYS = ['q', 'institutionGroup', 'kind', 'horizon', 'sector'];
export function parseActualTopPickQuery(input: ActualQueryInput, sectors: readonly string[] = []): ActualQuery {
  const invalid = (): ActualQuery => ({ status: 'invalid', filters: defaults(), errors: ['필터가 중복되었거나 허용하지 않은 값입니다. 초기화 후 다시 선택해 주세요.'] });
  try {
    const entries: [string, string][] = [];
    if (typeof input === 'string' || input instanceof URLSearchParams) {
      if (typeof input === 'string') { if (input.length > 2048) return invalid(); decodeURIComponent(input.replace(/\+/g, ' ')); }
      const params = typeof input === 'string' ? new URLSearchParams(input) : input;
      if (params.toString().length > 2048) return invalid();
      params.forEach((v, k) => entries.push([k, v]));
    } else {
      if (!input || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) return invalid();
      const descriptors = Object.getOwnPropertyDescriptors(input);
      for (const key of Reflect.ownKeys(descriptors)) {
        if (typeof key !== 'string' || !QUERY_KEYS.includes(key)) return invalid();
        const d = descriptors[key];
        if (!('value' in d) || !d.enumerable) return invalid();
        if (d.value === undefined) continue;
        if (typeof d.value !== 'string') return invalid();
        entries.push([key, d.value]);
      }
    }
    if (entries.length > QUERY_KEYS.length) return invalid();
    const filters = defaults(), seen = new Set<string>();
    for (const [key, value] of entries) {
      if (!QUERY_KEYS.includes(key) || seen.has(key) || /[\u0000-\u001f\u007f\ufffd]/.test(value) || value.length > 100) return invalid();
      seen.add(key);
      if (key === 'q') filters.q = value.trim();
      else {
        const choices = key === 'institutionGroup' ? ['all', ...GROUPS] : key === 'kind' ? ['all', 'stock', 'etf'] : key === 'horizon' ? ['all', ...HORIZONS] : ['all', 'unknown', ...sectors];
        if (!choices.includes(value)) return invalid();
        Object.assign(filters, { [key]: value });
      }
    }
    return { status: 'valid', filters, errors: [] };
  } catch { return invalid(); }
}
export function filterActualTopPicks(view: ActualTopPickView, query: ActualQuery): ActualRow[] {
  if (view.mode !== 'actual_review' || view.publicRelease !== false || query.status !== 'valid') return [];
  const checked = parseActualTopPickQuery(query.filters, view.sectors);
  if (checked.status !== 'valid') return [];
  const f = checked.filters, q = f.q.toLocaleLowerCase();
  return view.rows.filter(({ pick: p, report: r }) =>
    validReport(r) && validPick(p) && p.reportId === r.id && r.publishedOn >= view.window.start && r.publishedOn <= view.window.end
    && (f.institutionGroup === 'all' || r.institutionGroup === f.institutionGroup)
    && (f.kind === 'all' || p.kind === f.kind) && (f.horizon === 'all' || p.horizons.includes(f.horizon))
    && (f.sector === 'all' || (f.sector === 'unknown' ? p.sector === null : p.sector === f.sector))
    && (!q || [p.name, p.code ?? '', r.institution, r.title, p.sector ?? ''].some(v => v.toLocaleLowerCase().includes(q))));
}
/** Counts document evidence separately; dedup keys are report labels, not a verified instrument master. */
export function actualCounts(rows: readonly ActualRow[]) {
  const labelKey = (p: ActualPick) => `${p.kind}|${p.securityMarket ?? 'unknown'}|${p.code ?? p.name}`;
  return { records: rows.length, reports: new Set(rows.map(r => r.report.id)).size, securities: new Set(rows.map(r => labelKey(r.pick))).size };
}
