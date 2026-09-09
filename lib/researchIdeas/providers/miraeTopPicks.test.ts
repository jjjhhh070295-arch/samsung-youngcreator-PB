import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMiraeTopPicks, MIRAE_TOP_PICKS_COLUMNS, MIRAE_TOP_PICKS_FORMAT, type MiraeLayout, type MiraeCell } from './miraeTopPicks';

// All institutions' opinion fields, securities, numerical cells, hashes and layout
// coordinates below are synthetic. Column labels alone model the inspected format.
function cell(text: string, column: number, y: number): MiraeCell {
  return { text, box: [column / 14, y, (column + 1) / 14, y + 0.02] };
}
function fixture(): MiraeLayout {
  return {
    format: MIRAE_TOP_PICKS_FORMAT,
    document: {
      providerId: 'mirae', opinionProviderId: 'mirae', opinionSubject: '합성 기관 의견 주체 — 실제 의견 아님',
      desk: '주식전략', author: '합성 작성자', title: '합성 2026 하반기 시험 문서',
      publicationDate: '2026-05-22', sourceHash: 'a'.repeat(64), sourceUrl: null,
      origin: 'synthetic', pageCount: 68, targetPeriod: { label: '2026년 하반기', start: '2026-07-01', end: '2026-12-31' }, scenario: null,
    },
    tables: [{
      id: 'synthetic-table', page: 64, printedPage: '64', heading: { text: '2026년 하반기 Top Picks', box: [0, 0.01, 1, 0.05] },
      headers: MIRAE_TOP_PICKS_COLUMNS.map((s, i) => cell(s, i, 0.1)),
      asOf: { date: '2026-05-21', note: { text: '합성 주: 2026년 5월 21일 종가 기준', box: [0, 0.8, 1, 0.85] } },
      legends: [{ text: '합성 범례: 시장 약어 설명 미제공', box: [0, 0.87, 1, 0.9] }],
      rows: [
        { number: 1, cells: ['합성 업종 묶음', 'A000001', '가상기업A', 'KS', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map((s, i) => cell(s, i, 0.2)) },
        { number: 2, cells: ['합성 업종 묶음', 'A000002', '가상기업B', 'KQ', '1', '2', '3', '', '', '흑전', '적축', '-', '9', '10'].map((s, i) => cell(s, i, 0.25)) },
      ],
    }],
  };
}
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const withheld = (v: unknown, reason?: string) => {
  const result = extractMiraeTopPicks(v);
  assert.ok(result.status === 'withheld' || result.status === 'invalid_input');
  assert.deepEqual(result.candidates, []);
  if (reason) assert.ok(result.reasons.includes(reason), JSON.stringify(result));
};

test('extracts only review candidates with raw identifiers, periods and exact cells', () => {
  const input = fixture(), result = extractMiraeTopPicks(input);
  assert.equal(result.status, 'candidates');
  assert.equal(result.candidates.length, 2);
  const first = result.candidates[0];
  assert.deepEqual(first.instrument, { rawCode: 'A000001', rawName: '가상기업A', rawMarket: 'KS', canonicalId: null, verification: 'unverified' });
  assert.equal(first.document.origin, 'synthetic');
  assert.equal(first.document.sourceUrl, null);
  assert.deepEqual(first.document.targetPeriod, input.document.targetPeriod);
  assert.equal(first.evidence[0].page, 64);
  assert.equal(first.evidence[0].row, 1);
  assert.deepEqual(first.evidence[0].cells, input.tables[0].rows[0].cells);
  assert.deepEqual(first.evidence[0].headers, input.tables[0].headers);
  assert.deepEqual(first.evidence[0].asOf, input.tables[0].asOf);
  assert.deepEqual(first.evidence[0].legends, input.tables[0].legends);
  assert.equal(first.direction, 'unspecified');
  assert.equal(first.sector, null);
  assert.equal(first.reviewStatus, 'review_required');
  assert.equal(first.rightsStatus, 'unconfirmed');
  assert.equal(first.sourceVerification, 'unverified');
  assert.equal(first.publishable, false);
  assert.deepEqual(result, extractMiraeTopPicks(input));
});

test('retains blank cells, symbols and past-return headings without calculating returns', () => {
  const result = extractMiraeTopPicks(fixture()), row = result.candidates[1].evidence[0].cells;
  assert.deepEqual(row.slice(7).map(c => c.text), ['', '', '흑전', '적축', '-', '9', '10']);
  assert.equal('expectedReturn' in result.candidates[1], false);
  assert.equal('rank' in result.candidates[1], false);
});

test('deduplicates repeated tables while preserving every original location', () => {
  const input = fixture(), repeat = copy(input.tables[0]);
  repeat.id = 'repeat'; repeat.page = 5; repeat.printedPage = '5';
  input.tables = [...input.tables, repeat];
  const result = extractMiraeTopPicks(input);
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates[0].evidence.map(e => e.page), [64, 5]);
  assert.ok(result.reasons.includes('repeated_selection_deduplicated'));
});

test('conflicting name, market, group, number or as-of in repeated rows withholds the entire result', () => {
  for (const index of [0, 2, 3, 4]) {
    const input = fixture(), repeat = copy(input.tables[0]);
    repeat.id = 'repeat'; repeat.page = 5;
    repeat.rows[0].cells[index].text = index === 3 ? 'KQ' : '다른 합성 값';
    input.tables = [...input.tables, repeat];
    withheld(input, 'conflicting_duplicate_instrument');
  }
  const input = fixture(), repeat = copy(input.tables[0]);
  repeat.id = 'repeat'; repeat.page = 5;
  repeat.asOf = { date: '2026-05-20', note: { text: '합성: 2026년 5월 20일 종가 기준', box: [0, 0.8, 1, 0.85] } };
  input.tables = [...input.tables, repeat];
  withheld(input, 'conflicting_duplicate_instrument');
});

test('BUY, watchlist, sector preferences and mentions are not Top Pick tables', () => {
  for (const heading of ['BUY', '관심종목', '선호 업종', 'ETF 시장 동향', '가상기업A 단순 언급']) {
    const input = fixture(); input.tables[0].heading.text = heading;
    assert.equal(extractMiraeTopPicks(input).status, 'no_explicit_selection');
    assert.equal(extractMiraeTopPicks(input).candidates.length, 0);
  }
  for (const heading of ['Top Picks 및 관심종목', '2026년 하반기 Top Picks 아님', '과거 Top Picks', '타 기관 Top Picks', 'Top Picks']) {
    const input = fixture(); input.tables[0].heading.text = heading;
    withheld(input, 'ambiguous_or_unsupported_heading');
  }
});

test('provider, cited opinion owner and desk mismatches cannot borrow the publisher identity', () => {
  for (const field of ['providerId', 'opinionProviderId', 'desk'] as const) {
    const input = fixture(); input.document[field] = '다른 합성 기관';
    withheld(input, 'opinion_owner_or_desk_mismatch');
  }
});

test('an explicit heading cannot promote BUY, watchlist, past or quoted sub-groups', () => {
  for (const group of ['BUY', '관심 종목', 'Watchlist', '매수 등급', '단순 언급', '과거 선정', '이전 선정', '타 기관 선정', 'Top Pick 아님', '선정 제외']) {
    const input = fixture(); input.tables[0].rows[1].cells[0].text = group;
    withheld(input, 'ambiguous_selection_group');
  }
});

test('column removal, reordering, annual schema and unit changes fail closed', () => {
  for (const index of [0, 1, 5, 7, 13]) {
    const input = fixture(); input.tables[0].headers[index].text = '다른 연도/단위/열';
    withheld(input, 'unsupported_columns');
  }
  const missing = fixture(); missing.tables[0].headers = missing.tables[0].headers.slice(1);
  withheld(missing, 'unsupported_columns');
  const changed = fixture(); changed.format = 'mirae-annual-v1';
  withheld(changed, 'unsupported_format');
});

test('missing, impossible and non-H2 target periods are withheld', () => {
  const missing = fixture(); missing.document.targetPeriod = null;
  withheld(missing, 'target_period_missing_or_invalid');
  for (const value of [undefined, {}, { label: '2026년 하반기', start: '2026-02-30', end: '2026-12-31' }]) {
    withheld({ ...fixture(), document: { ...fixture().document, targetPeriod: value } }, 'target_period_missing_or_invalid');
  }
  const annual = fixture(); annual.document.targetPeriod = { label: '2026년', start: '2026-01-01', end: '2026-12-31' };
  withheld(annual, 'unsupported_target_period');
});

test('requires matching source-date footnote distinct from publication and target period', () => {
  for (const note of ['', '기준일 없음', '2026년 5월 20일 종가 기준']) {
    const input = fixture(); input.tables[0].asOf.note.text = note;
    withheld(input, 'as_of_evidence_mismatch');
  }
  const future = fixture(); future.document.publicationDate = '2026-05-20';
  withheld(future, 'as_of_evidence_mismatch');
});

test('broken rows, swapped cell geometry, invalid pages and duplicate row identities are withheld', () => {
  const broken = fixture(); broken.tables[0].rows[0].cells = broken.tables[0].rows[0].cells.slice(1);
  withheld(broken, 'broken_row');
  const shifted = fixture(); shifted.tables[0].rows[0].cells[2].box = [2 / 14, 0.3, 3 / 14, 0.32];
  withheld(shifted, 'row_geometry_mismatch');
  const swapped = fixture(); swapped.tables[0].rows[0].cells[1].box = swapped.tables[0].rows[0].cells[2].box;
  withheld(swapped, 'row_geometry_mismatch');
  const page = fixture(); page.tables[0].page = 69;
  withheld(page, 'invalid_table_layout');
  const duplicate = fixture(); duplicate.tables[0].rows[1].number = 1;
  withheld(duplicate, 'duplicate_row_identity');
});

test('handles merged group cells without inferring a per-stock sector', () => {
  const input = fixture();
  for (const row of input.tables[0].rows) row.cells[0].box = [0, 0.2, 1 / 14, 0.28];
  const result = extractMiraeTopPicks(input);
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.every(c => c.sector === null));
});

test('repeated header is not a security and empty recognized tables are withheld', () => {
  const input = fixture();
  input.tables[0].rows = [{ number: 3, cells: MIRAE_TOP_PICKS_COLUMNS.map((s, i) => cell(s, i, 0.15)) }, ...input.tables[0].rows];
  assert.equal(extractMiraeTopPicks(input).candidates.length, 2);
  const empty = fixture(); empty.tables[0].rows = [];
  withheld(empty, 'empty_top_pick_table');
  assert.equal(extractMiraeTopPicks({ ...fixture(), tables: [] }).status, 'no_explicit_selection');
});

test('never normalizes or guesses a broken code or market, and ignores no malformed trailing row', () => {
  for (const [index, value] of [[1, '1'], [1, '000001'], [3, 'UNKNOWN'], [2, 'BUY']] as const) {
    const input = fixture(); input.tables[0].rows[1].cells[index].text = value;
    withheld(input, 'instrument_identity_unresolved');
  }
});

test('keeps instructions inert, strips injected approval fields and never makes synthetic URLs', () => {
  const input = fixture(); input.document.title = '<script>throw new Error("no")</script>';
  const result = extractMiraeTopPicks({ ...input, document: { ...input.document, approved: true, customerId: 'synthetic-customer' } });
  assert.equal(result.status, 'candidates');
  assert.equal(result.candidates[0].document.title, input.document.title);
  assert.equal('approved' in result.candidates[0].document, false);
  assert.equal('customerId' in result.candidates[0].document, false);
  assert.equal(result.candidates[0].publishable, false);
  input.document.sourceUrl = 'https://example.invalid/fake-report.pdf';
  withheld(input, 'invalid_source_origin');
});

test('has no state between calls; source hashes change identity and output mutation cannot alter input', () => {
  const input = fixture(), snapshot = copy(input), result = extractMiraeTopPicks(input);
  result.candidates[0].evidence[0].cells[1].text = 'changed';
  result.candidates[0].document.targetPeriod!.label = 'changed';
  assert.deepEqual(input, snapshot);
  const next = fixture(); next.document.sourceHash = 'b'.repeat(64);
  assert.notEqual(extractMiraeTopPicks(next).candidates[0].id, result.candidates[0].id);
  const unrelated = fixture(); unrelated.tables[0].heading.text = 'BUY';
  assert.equal(extractMiraeTopPicks(unrelated).candidates.length, 0);
  assert.deepEqual(extractMiraeTopPicks(input), extractMiraeTopPicks(snapshot));
});

test('runtime shape and resource bounds reject malformed input without fallback candidates', () => {
  for (const value of [null, [], {}, { ...fixture(), tables: null }, { ...fixture(), document: null }]) withheld(value);
  for (const box of [[0, 0, NaN, 1], [0, 0, 2, 1], [0.5, 0.5, 0.1, 0.1]]) {
    const input = fixture(); input.tables[0].heading.box = box as [number, number, number, number]; withheld(input);
  }
  const tooMany = fixture(); tooMany.tables = Array.from({ length: 21 }, () => copy(tooMany.tables[0])); withheld(tooMany);
  const tooLong = fixture(); tooLong.tables[0].rows[0].cells[2].text = 'a'.repeat(2001); withheld(tooLong);
  const wrongDate = fixture(); wrongDate.document.publicationDate = '2026-02-30'; withheld(wrongDate);
});

test('sparse rows, headers, cells, coordinates and legends fail closed instead of skipping missing slots', () => {
  const rows = fixture(); rows.tables[0].rows = Array(1); withheld(rows, 'invalid_table_layout');
  const headers = fixture();
  headers.tables[0].headers = Array.from(headers.tables[0].headers);
  delete (headers.tables[0].headers as MiraeCell[])[1]; withheld(headers, 'invalid_table_layout');
  const missingCell = fixture();
  delete (missingCell.tables[0].rows[0].cells as MiraeCell[])[4]; withheld(missingCell, 'invalid_table_layout');
  const coordinates = fixture(), box = Array.from(coordinates.tables[0].heading.box); delete box[2];
  withheld({ ...coordinates, tables: [{ ...coordinates.tables[0], heading: { ...coordinates.tables[0].heading, box } }] }, 'invalid_table_layout');
  const legends = fixture(); legends.tables[0].legends = Array(1); withheld(legends, 'invalid_table_layout');
  withheld({ ...fixture(), tables: Array(1) }, 'invalid_table_layout');
});
