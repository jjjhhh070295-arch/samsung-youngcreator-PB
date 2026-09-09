import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildMarketIntelligencePrompt, mergeResearchInputs, selectResearchInputs, usableSavedResearch,
  RESEARCH_INTELLIGENCE_VERSION, type SavedResearchAnalysis } from './researchInputs';
import { buildMarketBrief, prepareResearchInputs, explainResearchPicks, type StructuredGenerator } from './marketIntelligence';
import type { MarketResearchItem } from '../portfolioResearch';
import type { SelectedTopPick } from './types';

const now = new Date('2026-09-10T03:00:00Z');
const report: SavedResearchAnalysis = {
  report_id: 'saved-report', title: '반도체 시장 점검', source: '네이버 금융 시황 리포트 · 신한투자증권',
  url: 'https://example.com/report.pdf', date: '2026-09-09', summary: '금리와 반도체 이익 전망을 함께 점검한 분석',
  signals: [{ signal: 'equity', direction: 1, strength: 3, evidence: '이익 전망 상향' }], model: 'existing-model',
};
const crawled: MarketResearchItem = { id: 'crawl-report', title: report.title, source: '신한투자증권 리서치', broker: '신한투자증권',
  url: 'https://broker.example/report.pdf', date: report.date!, signals: ['equity'] };
const output = () => ({ headline: '리서치 기반 시장 판단', marketSummary: '금리와 반도체 이익 전망을 함께 확인합니다.',
  timeline: { twoWeeks: '2주간 리서치 비교', threeDays: '최근 3일 리서치 변화', today: '오늘 발행 자료 부족' },
  keyIssues: [{ reportId: report.report_id, title: '반도체', summary: '이익 전망 검토', whatChanged: '이익 전망 변화', marketImpact: '리서치의 이익 개선 관점', watchPoint: '후속 리포트 확인' }],
  themes: [{ theme: '반도체', themeCode: 'SEMICONDUCTOR', score: 0.8, reason: '리서치 이익 전망' }],
  watchPoints: ['후속 리포트'], assetView: { equity: '선별', bond: '근거 부족', usd: '근거 부족', oil: '근거 부족' } });
function inputs() { return mergeResearchInputs({ crawled: [crawled], saved: [report], now }); }

describe('리서치 전용 Market Intelligence 입력·생성', () => {
  it('정상 분석만 사용하고 dummy 요약·신호는 모델에 전달하지 않는다', () => {
    assert.equal(usableSavedResearch([report, { ...report, model: 'dummy' }]).length, 1);
    const rows = mergeResearchInputs({ crawled: [], saved: [{ ...report, model: 'dummy' }], now });
    assert.deepEqual(rows, []);
  });
  it('크롤러와 탭의 동일 증권사·제목·날짜를 합치고 저장된 요약을 보존한다', () => {
    const [merged] = inputs();
    assert.equal(inputs().length, 1); assert.equal(merged.summary, report.summary);
    assert.deepEqual(merged.origins, ['research-tab', 'crawler']);
    assert.deepEqual(merged.sourceDocumentIds, ['saved-report', 'crawl-report']);
  });
  it('URL이 같으면 제목이 달라도 중복이며 날짜가 다른 새 리포트는 유지한다', () => {
    const rows = mergeResearchInputs({ saved: [report], crawled: [
      { ...crawled, title: '다른 제목', url: report.url },
      { ...crawled, id: 'next-day', date: '2026-09-10', url: 'https://broker.example/next.pdf' },
    ], now });
    assert.equal(rows.length, 2);
  });
  it('중간 사본이 URL과 메타데이터로 다른 사본을 연결해도 한 건으로 합친다', () => {
    const rows = mergeResearchInputs({ saved: [report, { ...report, report_id: 'second', title: '제목 별칭', url: 'https://example.com/alias.pdf' }],
      crawled: [{ ...crawled, title: report.title, url: 'https://example.com/alias.pdf' }], now });
    assert.equal(rows.length, 1); assert.equal(rows[0].sourceDocumentIds.length, 3);
  });
  it('미래·기간 밖 보고서는 제외하고 크롤링 키워드를 LLM 분석 신호로 둔갑시키지 않는다', () => {
    const rows = mergeResearchInputs({ saved: [], crawled: [crawled, { ...crawled, id: 'future', date: '2026-09-11' }, { ...crawled, id: 'old', date: '2026-07-01' }], now });
    assert.equal(rows.length, 1); assert.deepEqual(rows[0].signals, []);
  });
  it('입력 상한 안에서 현재 크롤러와 저장된 탭 자료를 모두 포함한다', () => {
    const rows = mergeResearchInputs({ crawled: Array.from({ length: 40 }, (_, i) => ({ ...crawled, id: 'crawl-' + i, title: '크롤링 ' + i, url: 'https://example.com/c/' + i })),
      saved: [{ ...report, title: '별도의 탭 리서치' }], now });
    const selected = selectResearchInputs(rows);
    assert.equal(selected.length, 30); assert.ok(selected.some((r) => r.id === report.report_id));
  });
  it('중복 제거 뒤 본문을 한 번만 읽고 실제 본문을 프롬프트에 포함한다', async () => {
    let calls = 0;
    const prepared = await prepareResearchInputs({ crawled: [crawled, crawled], saved: [report], canonical: [], now }, async () => { calls++; return '보고서 원문 발췌 '.repeat(30); });
    assert.equal(calls, 1); assert.equal(prepared.reports.length, 1);
    const prompt = buildMarketIntelligencePrompt({ tradeDate: '2026-09-10', reports: prepared.reports });
    assert.match(prompt, /보고서 원문 발췌/); assert.match(prompt, /금리와 반도체 이익 전망/);
    assert.doesNotMatch(prompt, /Claude|Gemini|아침 시장 본문/);
  });
  it('본문 추출 실패 시 기존 요약은 쓰되 제목뿐인 자료를 합성 입력에 넣지 않는다', async () => {
    const result = await prepareResearchInputs({ crawled: [crawled, { ...crawled, id: 'empty', title: '본문 없는 보고서', url: 'https://example.com/empty' }], saved: [report], canonical: [], now }, async () => { throw new Error('unavailable'); });
    assert.equal(result.reports.length, 1); assert.equal(result.excludedCount, 1);
  });
  it('빈 리서치 입력에서는 모델을 호출하지 않는다', async () => {
    let called = false;
    await assert.rejects(buildMarketBrief([], '2026-09-10', async () => { called = true; return { value: {}, model: 'test' }; }));
    assert.equal(called, false);
  });
  it('모델이 각 영역을 생성하고 출처 URL·날짜는 입력 ID로 확정한다', async () => {
    const result = await buildMarketBrief(inputs(), '2026-09-10', async (prompt, schema) => {
      assert.match(prompt, /현재|기준일/);
      const reportIds = (schema as any).properties.keyIssues.items.properties.reportId.enum;
      assert.deepEqual(reportIds, [report.report_id]);
      return { model: 'test-model', value: { ...output(), keyIssues: [{ ...output().keyIssues[0], url: 'https://invented.example', date: '2030-01-01' }] } };
    });
    assert.equal(result.value.keyIssues[0].url, report.url);
    assert.equal(result.value.keyIssues[0].date, report.date);
    assert.equal(result.value.themes[0].themeKo, '반도체');
    assert.equal(result.model, RESEARCH_INTELLIGENCE_VERSION + ':test-model');
  });
  it('없는 출처·잘못된 테마 점수·빈 필수 항목은 저장할 수 없다', async () => {
    for (const value of [
      { ...output(), keyIssues: [{ ...output().keyIssues[0], reportId: 'invented' }] },
      { ...output(), themes: [{ ...output().themes[0], score: 9 }] },
      { ...output(), headline: '' },
    ]) await assert.rejects(buildMarketBrief(inputs(), '2026-09-10', async () => ({ value, model: 'test' })));
  });
  it('선정되지 않은 종목 설명을 모델이 추가하면 거부한다', async () => {
    const pick = { ticker: '005930', company: '삼성전자', rank: 1, totalScore: 80, confidenceScore: 70 } as SelectedTopPick;
    await assert.rejects(explainResearchPicks([pick], new Map(), async () => ({ model: 'test', value: { explanations: [
      { ticker: '000660', summary: '임의 종목', keyReasons: [], risks: [] },
    ] } })));
    assert.equal(pick.rank, 1); assert.equal(pick.totalScore, 80);
  });
});
