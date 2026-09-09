/**
 * Pure, review-only adapter for one inspected table format (2026 H2 strategy).
 * Input is a supplied layout, NOT PDF bytes or flattened crawler text. It has not
 * been independently authenticated. No fetch, PDF parsing, AI, DB, env or UI.
 * The format reference is 2144785.pdf, printed/PDF p64; no real picks are seeded.
 */
export const MIRAE_TOP_PICKS_FORMAT = 'mirae-equity-strategy-2026-h2-v1';
export const MIRAE_TOP_PICKS_COLUMNS: readonly string[] = Object.freeze([
  '2026년 하반기 선호 업종', '종목코드', '종목명', '시장', '시가총액 (조원)',
  '주가 상승률(%) 3M', '주가 상승률(%) YTD',
  '매출액 증가율(%) 2026F', '매출액 증가율(%) 2027F',
  '영업이익 증가율(%) 2026F', '영업이익 증가율(%) 2027F',
  '12MF P/E', '12MF P/B', '12MF ROE',
]);

/** Normalized page coordinates: [left, top, right, bottom], in [0, 1]. */
export type MiraeCell = { text: string; box: readonly [number, number, number, number] };
export type MiraeTable = {
  id: string; page: number; printedPage: string;
  heading: MiraeCell; headers: readonly MiraeCell[];
  asOf: { date: string; note: MiraeCell };
  legends: readonly MiraeCell[];
  rows: readonly { number: number; cells: readonly MiraeCell[] }[];
};
export type MiraeLayout = {
  format: string;
  document: {
    providerId: string; opinionProviderId: string; opinionSubject: string;
    desk: string; author: string; title: string;
    publicationDate: string; sourceHash: string; sourceUrl: string | null;
    origin: 'synthetic' | 'actual'; pageCount: number;
    targetPeriod: { label: string; start: string; end: string } | null;
    scenario: string | null;
  };
  tables: readonly MiraeTable[];
};
export type MiraeEvidence = {
  page: number; printedPage: string; tableId: string; row: number;
  heading: MiraeCell; headers: MiraeCell[]; cells: MiraeCell[];
  asOf: { date: string; note: MiraeCell }; legends: MiraeCell[];
};
export type MiraeCandidate = {
  id: string; kind: 'stock'; selection: 'top_pick'; direction: 'unspecified';
  reviewStatus: 'review_required'; publishable: false;
  rightsStatus: 'unconfirmed'; sourceVerification: 'unverified';
  parserVersion: typeof MIRAE_TOP_PICKS_FORMAT;
  document: MiraeLayout['document'];
  instrument: { rawCode: string; rawName: string; rawMarket: string; canonicalId: null; verification: 'unverified' };
  sector: null;
  evidence: MiraeEvidence[];
};
export type MiraeExtraction = {
  status: 'candidates' | 'no_explicit_selection' | 'withheld' | 'invalid_input';
  candidates: MiraeCandidate[];
  reasons: string[];
};

const MAX_TABLES = 20;
const MAX_ROWS = 200;
const MAX_TEXT = 2000;
const normalized = (text: string) => text.replace(/\s+/g, '').toLowerCase();
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown, max = MAX_TEXT): v is string => typeof v === 'string' && v.length <= max && /\S/.test(v) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v);
const integer = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= max;
function date(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const parsed = new Date(`${v}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === v;
}
function cell(v: unknown): v is MiraeCell {
  if (!record(v) || typeof v.text !== 'string' || v.text.length > MAX_TEXT || !Array.isArray(v.box) || v.box.length !== 4) return false;
  const b = v.box;
  return Array.from(b).every(x => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1)
    && b[0] < b[2] && b[1] < b[3];
}
function cells(v: unknown, max: number): v is MiraeCell[] {
  // Array.every skips sparse slots; a missing cell is not an empty financial value.
  return Array.isArray(v) && v.length <= max && Array.from(v).every(cell);
}
const cloneCell = (c: MiraeCell): MiraeCell => ({ text: c.text, box: [...c.box] });
const fail = (reason: string, status: MiraeExtraction['status'] = 'withheld'): MiraeExtraction => ({ status, candidates: [], reasons: [reason] });

function documentShape(v: unknown): v is MiraeLayout['document'] {
  return record(v) && ['providerId', 'opinionProviderId', 'opinionSubject', 'desk', 'author', 'title'].every(k => text(v[k], 300))
    && date(v.publicationDate) && typeof v.sourceHash === 'string' && /^[0-9a-f]{64}$/i.test(v.sourceHash)
    && (v.sourceUrl === null || text(v.sourceUrl, 2000))
    && (v.origin === 'synthetic' || v.origin === 'actual') && integer(v.pageCount, 100)
    && (v.scenario === null || text(v.scenario, 300));
}
function tableShape(v: unknown, pages: number): v is MiraeTable {
  return record(v) && text(v.id, 100) && integer(v.page, pages) && text(v.printedPage, 30)
    && cell(v.heading) && cells(v.headers, 30) && record(v.asOf) && date(v.asOf.date) && cell(v.asOf.note)
    && cells(v.legends, 20) && Array.isArray(v.rows) && v.rows.length <= MAX_ROWS
    && Array.from(v.rows).every(r => record(r) && integer(r.number, MAX_ROWS) && cells(r.cells, 30));
}
function aligned(headers: readonly MiraeCell[], row: readonly MiraeCell[]): boolean {
  const identity = row[1].box;
  return row.every((c, i) => {
    const h = headers[i].box, b = c.box;
    // Do not attach a code to the next row/name after a broken PDF layout.
    const sameRow = i === 0 ? b[1] <= identity[1] && b[3] >= identity[3]
      : Math.abs(b[1] - identity[1]) <= 0.005 && Math.abs(b[3] - identity[3]) <= 0.005;
    return sameRow && b[1] >= h[3] && b[0] >= h[0] - 0.005 && b[2] <= h[2] + 0.005;
  });
}
function sourceUrlValid(doc: MiraeLayout['document']): boolean {
  if (doc.origin === 'synthetic') return doc.sourceUrl === null; // Never a fake real-report button.
  try {
    const url = new URL(doc.sourceUrl ?? '');
    return url.origin === 'https://securities.miraeasset.com' && !url.username && !url.password && !url.hash
      && /^\/bbs\/download\/\d+\.pdf$/.test(url.pathname);
  } catch { return false; }
}
function cloneDocument(d: MiraeLayout['document']): MiraeLayout['document'] {
  // Pick fields explicitly: injected approval/customer/action fields never flow out.
  return {
    providerId: d.providerId, opinionProviderId: d.opinionProviderId, opinionSubject: d.opinionSubject,
    desk: d.desk, author: d.author, title: d.title, publicationDate: d.publicationDate,
    sourceHash: d.sourceHash, sourceUrl: d.sourceUrl, origin: d.origin, pageCount: d.pageCount,
    targetPeriod: d.targetPeriod ? { label: d.targetPeriod.label, start: d.targetPeriod.start, end: d.targetPeriod.end } : null,
    scenario: d.scenario,
  };
}

/** No trust/approval decisions: even a well-formed actual layout yields ONLY unverified candidates. */
export function extractMiraeTopPicks(input: unknown): MiraeExtraction {
  if (!record(input) || !documentShape(input.document) || !Array.isArray(input.tables)
    || input.tables.length > MAX_TABLES) return fail('invalid_document_or_tables', 'invalid_input');
  if (input.format !== MIRAE_TOP_PICKS_FORMAT) return fail('unsupported_format');
  const doc = input.document;
  if (doc.providerId !== 'mirae' || doc.opinionProviderId !== 'mirae' || normalized(doc.desk) !== '주식전략') return fail('opinion_owner_or_desk_mismatch');
  if (!sourceUrlValid(doc)) return fail('invalid_source_origin', 'invalid_input');
  const period = doc.targetPeriod;
  if (!record(period) || !text(period.label) || !date(period.start) || !date(period.end)) return fail('target_period_missing_or_invalid');
  // One reviewed format, not a universal/year-agnostic broker parser.
  if (normalized(period.label) !== '2026년하반기' || period.start !== '2026-07-01' || period.end !== '2026-12-31') return fail('unsupported_target_period');
  const candidates = new Map<string, { candidate: MiraeCandidate; fingerprint: string }>();
  const usedTables = new Set<string>();
  const reasons = new Set<string>();
  let recognized = false;
  let totalRows = 0;
  for (const raw of input.tables) {
    if (!tableShape(raw, doc.pageCount)) return fail('invalid_table_layout', 'invalid_input');
    const table = raw;
    const tableKey = JSON.stringify([table.page, table.id]);
    if (usedTables.has(tableKey)) return fail('duplicate_table_identity', 'invalid_input');
    usedTables.add(tableKey);
    const heading = normalized(table.heading.text);
    if (heading !== '2026년하반기toppicks') {
      // BUY/watchlist/sector/narrative headings are never a stock selection.
      if (/toppick/.test(heading)) return fail('ambiguous_or_unsupported_heading');
      reasons.add('non_top_pick_table_ignored');
      continue;
    }
    recognized = true;
    if (table.headers.length !== MIRAE_TOP_PICKS_COLUMNS.length || table.headers.some((h, i) => normalized(h.text) !== normalized(MIRAE_TOP_PICKS_COLUMNS[i]))) return fail('unsupported_columns');
    if (table.headers.some((h, i) => h.box[1] < table.heading.box[3] || (i > 0 && h.box[0] < table.headers[i - 1].box[2]))) return fail('invalid_header_geometry');
    if (!table.rows.length) return fail('empty_top_pick_table');
    const noteDate = /(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일.*종가\s*기준/.exec(table.asOf.note.text);
    if (!noteDate || `${noteDate[1]}-${noteDate[2].padStart(2, '0')}-${noteDate[3].padStart(2, '0')}` !== table.asOf.date || table.asOf.date > doc.publicationDate) return fail('as_of_evidence_mismatch');
    const usedRows = new Set<number>();
    for (const row of table.rows) {
      totalRows++;
      if (totalRows > MAX_ROWS) return fail('row_limit_exceeded', 'invalid_input');
      if (usedRows.has(row.number)) return fail('duplicate_row_identity', 'invalid_input');
      usedRows.add(row.number);
      if (row.cells.length !== table.headers.length) return fail('broken_row');
      if (row.cells.every((c, i) => normalized(c.text) === normalized(MIRAE_TOP_PICKS_COLUMNS[i]))) {
        reasons.add('repeated_header_ignored'); continue;
      }
      if (!aligned(table.headers, row.cells) || row.cells.some(c => c.box[3] > table.asOf.note.box[1])) return fail('row_geometry_mismatch');
      const [group, code, name, market] = row.cells.map(c => c.text);
      if (!/^A\d{6}$/.test(code) || !/^(KS|KQ)$/.test(market) || !text(group) || !text(name, 100)
        || /buy|watchlist|관심종목|매수|<|>|https?:|javascript:|eval\(|process\.|ignore previous/i.test(name)) return fail('instrument_identity_unresolved');
      // A correct main heading does not promote a watchlist/quoted/past sub-group.
      if (/buy|watchlist|관심종목|매수|단순언급|과거|이전선정|타기관|아님|제외/.test(normalized(group))) return fail('ambiguous_selection_group');
      // Same code + different name, market, period data, or merged category is a conflict, not a new recommendation.
      const fingerprint = JSON.stringify([row.cells.map(c => c.text.replace(/\s+/g, ' ').trim()), table.asOf.date]);
      const evidence: MiraeEvidence = {
        page: table.page, printedPage: table.printedPage, tableId: table.id, row: row.number,
        heading: cloneCell(table.heading), headers: table.headers.map(cloneCell), cells: row.cells.map(cloneCell),
        asOf: { date: table.asOf.date, note: cloneCell(table.asOf.note) }, legends: table.legends.map(cloneCell),
      };
      const seen = candidates.get(code);
      if (seen) {
        if (seen.fingerprint !== fingerprint) return fail('conflicting_duplicate_instrument');
        seen.candidate.evidence.push(evidence); reasons.add('repeated_selection_deduplicated');
        continue;
      }
      candidates.set(code, {
        fingerprint,
        candidate: {
          id: JSON.stringify([MIRAE_TOP_PICKS_FORMAT, doc.sourceHash.toLowerCase(), doc.opinionProviderId, doc.desk, period.start, period.end, doc.scenario, code, market]),
          kind: 'stock', selection: 'top_pick', direction: 'unspecified', reviewStatus: 'review_required', publishable: false,
          rightsStatus: 'unconfirmed', sourceVerification: 'unverified', parserVersion: MIRAE_TOP_PICKS_FORMAT,
          document: cloneDocument(doc), instrument: { rawCode: code, rawName: name, rawMarket: market, canonicalId: null, verification: 'unverified' },
          sector: null, evidence: [evidence],
        },
      });
    }
  }
  if (recognized && !candidates.size) return fail('empty_top_pick_table');
  if (!recognized) return { status: 'no_explicit_selection', candidates: [], reasons: [...Array.from(reasons), 'no_explicit_top_pick_table'] };
  reasons.add('source_identity_rights_and_selection_require_review');
  reasons.add('market_legend_sector_and_numeric_cells_not_interpreted');
  return { status: 'candidates', candidates: Array.from(candidates.values(), x => x.candidate), reasons: Array.from(reasons) };
}
