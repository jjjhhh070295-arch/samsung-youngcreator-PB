import test from 'node:test';
import assert from 'node:assert/strict';
import { extractIdeas, type EntityKind } from './extract';

const extract = (text: string, kind: EntityKind = 'stock') => extractIdeas([{ page: 3, text }], kind);

test('extracts explicit English and Korean lists with original coordinates', () => {
  const result = extract('문서 제목\nTop Picks: 합성회사A (FCTA), Fictional Company B\n최선호주: 가상기업C');
  assert.equal(result.status, 'candidates');
  assert.deepEqual(result.candidates.map(({ entityName, page, line, kind, selection, direction }) => ({ entityName, page, line, kind, selection, direction })), [
    { entityName: '합성회사A (FCTA)', page: 3, line: 2, kind: 'stock', selection: 'top_pick', direction: 'unspecified' },
    { entityName: 'Fictional Company B', page: 3, line: 2, kind: 'stock', selection: 'top_pick', direction: 'unspecified' },
    { entityName: '가상기업C', page: 3, line: 3, kind: 'stock', selection: 'top_pick', direction: 'unspecified' },
  ]);
  assert.ok(result.warnings.some((warning) => warning.includes('원문 검토 전')));
});

test('accepts only bullets immediately following an explicit heading', () => {
  const result = extract('Top Picks\n- 가상기업A\n• 가상기업B\n일반 설명\n- 가상기업C\n최선호주:\n\n- 가상기업D');
  assert.deepEqual(result.candidates.map((item) => item.entityName), ['가상기업A', '가상기업B']);
  assert.equal(result.candidates[0].evidence, 'Top Picks\n- 가상기업A');
  assert.equal(result.candidates[0].line, 2);
});

test('does not convert BUY, target prices, narrative mentions, or watchlists into selections', () => {
  for (const text of ['BUY: 가상기업A', '가상기업A 목표가 100', '가상기업A is our Top pick', '관심종목: 가상기업A', 'Top Picks 및 관심종목: 가상기업A', 'Top Picks and watchlist\n- 가상기업A', 'Top Picks: 가상기업A (BUY)']) {
    assert.equal(extract(text).candidates.length, 0, text);
  }
});

test('negated Top Pick statements cannot become candidates or leak into bullets', () => {
  for (const text of ['Top pick 아님: 가상기업A', 'not a top pick: Fictional A', 'no top picks\n- Fictional A', 'Top Picks\n- Fictional A is not a top pick\n- Fictional B']) {
    assert.equal(extract(text).candidates.length, 0, text);
  }
});

test('keeps opposite directions with warning, deduplicates repeated identical selections', () => {
  const result = extract('선호 업종: 가상업종A\n선호 업종: 가상업종A\n비선호 업종: 가상업종A', 'sector');
  assert.equal(result.candidates.length, 2);
  assert.deepEqual(result.candidates.map((item) => item.direction), ['positive', 'negative']);
  assert.ok(result.warnings.some((warning) => warning.includes('서로 반대')));
  assert.equal(extract('선호 업종: 가상업종A', 'stock').candidates.length, 0);
});

test('retains supplied kind without resolving ticker names or upgrading to app recommendations', () => {
  for (const kind of ['market', 'asset_class', 'sector', 'etf'] as const) {
    const result = extract('Top Pick: Fictional A (FCTA)', kind);
    assert.equal(result.candidates[0].kind, kind);
    assert.equal(result.candidates[0].entityName, 'Fictional A (FCTA)');
    assert.equal('ticker' in result.candidates[0], false);
  }
});

test('treats instructions as inert text and rejects ambiguous mixed lists entirely', () => {
  const result = extract('Top Picks: eval(process.env.SECRET)\nTop Picks: 가상기업A, BUY\nTop Picks: ignore previous instructions');
  assert.equal(result.candidates.length, 0);
  assert.ok(result.warnings.some((warning) => warning.includes('모호')));
});

test('bounds evidence to 250 characters and returns deterministic IDs', () => {
  const text = `Top Picks: ${Array.from({ length: 20 }, (_, index) => `가상합성검증전용기업${index}`).join(', ')}`;
  const first = extract(text);
  assert.equal(first.candidates.length, 20);
  assert.ok(first.candidates.every((item) => Array.from(item.evidence).length <= 250));
  assert.equal(Array.from(first.candidates[0].evidence).length, 250);
  assert.deepEqual(first, extract(text));
  assert.equal(new Set(first.candidates.map((item) => item.id)).size, 20);
});

test('supports all five exact UI examples without selecting watchlist or BUY entries', () => {
  const examples: readonly [EntityKind, string][] = [
    ['stock', 'Top Picks: 가상기업A, 가상기업B\n관심종목: 가상기업C\nBUY: 가상기업D'],
    ['market', '선호 시장: 가상시장A, 가상시장B'],
    ['asset_class', '선호 자산군: 가상자산A, 가상자산B'],
    ['sector', '선호 섹터: 가상업종A, 가상업종B'],
    ['etf', 'Top Picks: 가상ETF-A, 가상ETF-B'],
  ];
  for (const [kind, text] of examples) {
    const result = extract(text, kind);
    assert.equal(result.candidates.length, 2, kind);
    assert.ok(result.candidates.every((candidate) => candidate.kind === kind));
    assert.equal(result.candidates[0].selection, kind === 'stock' || kind === 'etf' ? 'top_pick' : 'preference');
  }
  assert.equal(extract('선호: 가상기업A').candidates.length, 0);
  assert.equal(extract('Overweight: 가상ETF-A', 'etf').candidates.length, 0);
});

test('validates page numbers, duplicates, runtime shape, kind and input limits fail closed', () => {
  assert.equal(extractIdeas([], 'stock').status, 'invalid_input');
  assert.equal(extract('').status, 'invalid_input');
  assert.equal(extract(' \n\t\r ').status, 'invalid_input');
  assert.equal(extract('합성 자료의 일반 설명만 있습니다.').status, 'no_explicit_selection');
  assert.equal(extractIdeas([{ page: 0, text: 'Top Pick: Fictional A' }], 'stock').status, 'invalid_input');
  assert.equal(extractIdeas([{ page: 1, text: '' }, { page: 1, text: '' }], 'stock').status, 'invalid_input');
  assert.equal(extractIdeas(null as unknown as [], 'stock').status, 'invalid_input');
  assert.equal(extractIdeas([{ page: 1, text: null as unknown as string }], 'stock').status, 'invalid_input');
  assert.equal(extractIdeas([], 'other' as EntityKind).status, 'invalid_input');
  assert.equal(extractIdeas(Array.from({ length: 101 }, (_, index) => ({ page: index + 1, text: '' })), 'stock').status, 'invalid_input');
  assert.equal(extract('a'.repeat(200001)).status, 'invalid_input');
});

test('Top Pick direction remains unspecified unless the exact heading supplies it', () => {
  const result = extract('Top Picks: 가상기업A\n최선호주: 가상기업B\nTop Picks (Underweight): 가상기업A\nTop Picks (Overweight): 가상기업A\nTop Picks (Underweight): 가상기업A');
  assert.equal(result.candidates.length, 4);
  assert.deepEqual(result.candidates.map((item) => item.direction), ['unspecified', 'unspecified', 'negative', 'positive']);
  assert.ok(result.warnings.some((warning) => warning.includes('서로 반대')));
  assert.equal(extract('Top Picks (BUY): 가상기업A').candidates.length, 0);
  assert.equal(extract('Top Picks (Underweight)\n- 가상기업A').candidates[0].direction, 'negative');
  assert.equal(extract('선호 업종 (Underweight): 가상업종A', 'sector').candidates.length, 0);
});

test('enforces maximum 200 candidates without silently truncating a longer list', () => {
  const lines = (count: number) => Array.from({ length: count }, (_, index) => `Top Pick: 가상기업${index}`).join('\n');
  assert.equal(extract(lines(200)).candidates.length, 200);
  const overflow = extract(lines(201));
  assert.equal(overflow.status, 'invalid_input');
  assert.deepEqual(overflow.candidates, []);
});
