"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getLoggedInPbId, onSessionChanged } from "@/lib/auth";
import { actualCounts, filterActualTopPicks, getActualSourceHref, HORIZON_LABELS, INSTITUTION_LABELS, type ActualQuery, type ActualRow, type ActualTopPickView, type Horizon, type InstitutionGroup } from "@/lib/researchIdeas/actualTopPickView";

type Props = { view: ActualTopPickView; query: ActualQuery };
const inputClass = "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600";
const focusClass = "rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2";

/** Existing account display is navigation UX, NOT server authorization or a publishing gate. */
export default function ActualTopPickExplorer(props: Props) {
  const [pbId, setPbId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    const update = () => setPbId(getLoggedInPbId());
    const unsubscribe = onSessionChanged(update);
    update();
    return unsubscribe;
  }, []);
  if (pbId === undefined) return <p role="status" className="p-8">로그인 상태 확인 중…</p>;
  if (!pbId) return <section className="mx-auto my-10 max-w-xl space-y-4 rounded-2xl border border-slate-200 bg-white p-8 text-slate-900">
    <h1 className="text-2xl font-bold">기존 계정으로 로그인해 주세요</h1>
    <p className="text-sm leading-6">기존 로그인 방식은 바꾸지 않았습니다. 이 화면은 공개 원문에서 대조한 선정 기록의 로컬 검토용이며, 로그인 표시는 서버 권한 검증이나 자료 이용권을 보장하지 않습니다.</p>
    <Link href="/" prefetch={false} className={`inline-block bg-blue-700 px-4 py-2 text-white ${focusClass}`}>로그인 화면으로</Link>
  </section>;
  return <Workspace key={`${pbId}:${JSON.stringify(props.query)}`} {...props} />;
}

function Workspace({ view, query }: Props) {
  const rows = filterActualTopPicks(view, query), count = actualCounts(rows), filters = query.filters;
  const activeFilters = [
    filters.q ? `검색: ${filters.q}` : null,
    filters.institutionGroup !== 'all' ? INSTITUTION_LABELS[filters.institutionGroup] : null,
    filters.kind !== 'all' ? filters.kind === 'stock' ? '주식' : 'ETF' : null,
    filters.horizon !== 'all' ? HORIZON_LABELS[filters.horizon] : null,
    filters.sector !== 'all' ? filters.sector === 'unknown' ? '섹터·테마 미확인' : filters.sector : null,
  ].filter(Boolean).join(' · ') || '전체 기록';
  const coverage = [
    ...(['samsung', 'domestic_other', 'foreign'] as InstitutionGroup[]).map(group => ({ label: INSTITUTION_LABELS[group], rows: rows.filter(row => row.report.institutionGroup === group) })),
    { label: '주식', rows: rows.filter(row => row.pick.kind === 'stock') },
    { label: 'ETF', rows: rows.filter(row => row.pick.kind === 'etf') },
    ...(['short', 'medium-long', 'unknown'] as Horizon[]).map(horizon => ({ label: HORIZON_LABELS[horizon], rows: rows.filter(row => row.pick.horizons.includes(horizon)) })),
  ];
  return <div className="min-h-screen bg-slate-50 px-4 py-4 text-slate-900 sm:px-8">
    <div className="mx-auto max-w-6xl space-y-3">
      <header className="rounded-2xl bg-slate-900 p-4 text-white sm:p-5">
        <Link href="/research" prefetch={false} className={`text-xs text-blue-200 ${focusClass}`}>← 기존 리서치로</Link>
        <h1 className="mt-2 text-xl font-bold sm:text-2xl">기관 Top Pick 선정 기록</h1>
        <p className="mt-2 text-xs leading-5 text-slate-200">최근 한 달의 기관 선정 기록입니다. 현재 유효한 추천·신규 추천 목록이 아닙니다. 앱 추천·고객 자동 전달은 하지 않습니다.</p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
          <span className="rounded-full bg-blue-100 px-3 py-1 font-semibold text-blue-950">실제 원문 대조 · 수동 정리</span>
          <span className="rounded-full bg-amber-300 px-3 py-1 font-semibold text-slate-950">로컬 검토 전용 · 공개 제공 미승인</span>
          <span className="rounded-full border border-slate-600 px-3 py-1">이 기능: 자동 수집 · DB 연결 없음</span>
        </div>
        <p className="mt-2 text-xs text-slate-300">발행일 고정 범위: {view.window.start} ~ {view.window.end} (양 끝 날짜 포함). 실시간 갱신되지 않습니다.</p>
      </header>

      <aside aria-label="검토 범위와 사용 제한" className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">
        <strong>사용권 미확인 · 공개 제공 미승인.</strong> 로그인 표시는 서버 권한 검증이 아닙니다.
        <details id="actual-top-pick-disclosures" className="mt-1">
          <summary className={`cursor-pointer font-semibold ${focusClass}`}>이용 제한·기간 분류 기준 보기</summary>
          <p className="mt-2"><strong>원문 확인과 사용권 승인은 다릅니다.</strong> 링크와 선정 근거를 대조했지만 재배포·AI 처리·내부 공유 등의 용도별 사용권은 미확인입니다. 현재 공개 제공 승인값은 false이며, 이 표시 자체가 접근 통제는 아닙니다. 운영 공개 전 별도 권리·서버 권한 검증이 필요합니다.</p>
          <p className="mt-2">원문상의 기간이 명시된 경우만 단기·중장기로 분류합니다. 보고서 발행일이나 제목의 월·분기만으로 투자 기간을 추정하지 않습니다. 뒤에 철회된 기록과 편집 불일치는 숨기지 않고 함께 표시합니다.</p>
        </details>
      </aside>

      <details id="actual-top-pick-filters" className="rounded-xl border border-slate-200 bg-white px-4 py-3">
        <summary className={`cursor-pointer text-sm font-bold ${focusClass}`}>검색·필터 열기</summary>
        <form action="/research/top-picks" method="get" className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="text-sm font-medium">종목명 · 코드 · 기관 · 보고서<input name="q" type="search" maxLength={100} defaultValue={filters.q} className={inputClass} /></label>
          <label className="text-sm font-medium">선정 기관 구분<select name="institutionGroup" defaultValue={filters.institutionGroup} className={inputClass}><option value="all">전체 기관</option>{(Object.keys(INSTITUTION_LABELS) as InstitutionGroup[]).map(group => <option key={group} value={group}>{INSTITUTION_LABELS[group]}</option>)}</select></label>
          <label className="text-sm font-medium">자산 종류<select name="kind" defaultValue={filters.kind} className={inputClass}><option value="all">주식 · ETF</option><option value="stock">주식</option><option value="etf">ETF</option></select></label>
          <label className="text-sm font-medium">원문에 명시된 투자 기간<select name="horizon" defaultValue={filters.horizon} className={inputClass}><option value="all">전체 기간</option>{(Object.keys(HORIZON_LABELS) as Horizon[]).map(h => <option key={h} value={h}>{HORIZON_LABELS[h]}</option>)}</select></label>
          <label className="text-sm font-medium">원문 섹터·테마<select name="sector" defaultValue={filters.sector} className={inputClass}><option value="all">전체 섹터·테마</option><option value="unknown">섹터·테마 미확인</option>{view.sectors.map(sector => <option key={sector} value={sector}>{sector}</option>)}</select></label>
          <div className="flex items-end gap-3"><button type="submit" className={`bg-blue-700 px-5 py-2 text-sm font-semibold text-white ${focusClass}`}>필터 적용</button><Link href="/research/top-picks" prefetch={false} onClick={event => event.currentTarget.closest('form')?.reset()} className={`px-3 py-2 text-sm text-slate-600 ${focusClass}`}>초기화</Link></div>
        </form>
        <p className="mt-3 text-xs leading-5 text-slate-500">국내 기관의 해외 주식 보고서는 ‘기타 국내 기관’입니다. 기관 소재지와 종목 상장시장은 별개입니다. 단기·중장기 동시 명시 기록은 양쪽 필터에 나타납니다.</p>
      </details>
      <p aria-label="현재 적용 필터" className="break-words text-xs text-slate-600">적용 조건: {query.status === 'invalid' ? '잘못된 필터 · 표시 보류' : activeFilters}</p>

      {query.status === 'invalid' ? <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">{query.errors.join(' ')} 확인 전에는 기록을 표시하지 않습니다.</div> : null}
      {view.withheld.length > 0 ? <section role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900"><h2 className="font-bold">일부 자료 표시 보류</h2><ul className="mt-2 list-inside list-disc">{view.withheld.map((reason, i) => <li key={i}>{reason}</li>)}</ul></section> : null}

      <section aria-labelledby="actual-top-pick-results-title" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="actual-top-pick-results-title" className="text-xl font-bold">선정 기록 {count.records}건</h2>
          <p className="text-sm text-slate-600">표기 기준 종목 {count.securities}개 · 원문 보고서 {count.reports}개</p>
        </div>
        <details id="actual-top-pick-coverage" className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <summary className={`cursor-pointer text-xs font-semibold text-slate-600 ${focusClass}`}>분류별 확보 현황·집계 기준 보기</summary>
          <p className="mt-2 text-xs leading-5 text-slate-500">같은 종목의 여러 보고서 기록은 근거를 합쳐 지우지 않습니다. 종목 수는 종류·시장·코드(없으면 이름) 표기 기준이며, 검증된 종목 마스터나 현재 추천 수가 아닙니다.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{coverage.map(item => <Coverage key={item.label} label={item.label} count={actualCounts(item.rows).securities} />)}</div>
          <p className="mt-2 text-xs text-slate-500">10개는 자료 확보 목표일 뿐 투자 품질 기준이 아닙니다. 기간 분류가 겹치므로 분류별 숫자를 합산하지 않습니다. 미확인 기간을 임의로 채우지 않습니다.</p>
        </details>
        {rows.length ? <div className="grid items-start gap-4 lg:grid-cols-2">{rows.map(row => <RecordCard key={row.pick.id} row={row} />)}</div> : <div className="rounded-xl border border-dashed border-slate-300 bg-white p-8 text-center"><h3 className="font-semibold">표시할 선정 기록이 없습니다</h3><p className="mt-2 text-sm text-slate-500">현재 조건의 검수 자료가 없다는 뜻이며, 해당 종목·시장에 투자 매력이 없다는 뜻은 아닙니다.</p></div>}
      </section>
      <footer className="border-t border-slate-200 pt-4 text-xs leading-5 text-slate-500">실제 원문 대조 기록 · 추가 검수 필요 · 사용권 미확인 · 운영 공개 미승인. 기존 계정 표시는 탐색 편의용이며 서버 인증이 아닙니다. 앱 추천·고객 승인·포트폴리오 반영·메일·PDF 발송은 수행하지 않습니다.</footer>
    </div>
  </div>;
}
function Coverage({ label, count }: { label: string; count: number }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-xs text-slate-600">{label}</p><p className="mt-1 text-lg font-bold">{count}개 <span className={`text-xs font-normal ${count < 10 ? 'text-amber-700' : 'text-slate-500'}`}>{count < 10 ? '10개 미만 · 추가 근거 필요' : '표기 기준 확보'}</span></p></div>;
}
function RecordCard({ row: { pick, report } }: { row: ActualRow }) {
  const href = getActualSourceHref(report, pick.page);
  const warnings = [...(report.warnings ?? []), ...(pick.warnings ?? [])];
  const statusText = pick.status === 'withdrawn_later' ? '후속 철회 확인 · 현재 추천 아님' : pick.status === 'conflicting' ? '편집·근거 불일치 · 판단 보류' : '당시 선정 기록 · 현재 유효성 미확인';
  return <article className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
    <p className="text-xs font-semibold text-blue-700">{report.institution} · {INSTITUTION_LABELS[report.institutionGroup]}</p>
    <div className="mt-2 flex flex-wrap items-start justify-between gap-2"><h3 className="break-words text-xl font-bold">{pick.name}</h3><span className="rounded-full bg-slate-100 px-3 py-1 text-xs">{pick.kind === 'etf' ? 'ETF' : '주식'}</span></div>
    <p className="mt-1 break-words text-xs text-slate-500">코드: {pick.code ?? '미확인'} · 종목 시장: {pick.securityMarket ?? '미확인'}</p>
    <p className={`mt-3 rounded-lg p-3 text-sm font-semibold ${pick.status === 'withdrawn_later' || pick.status === 'conflicting' ? 'bg-red-50 text-red-900' : 'bg-amber-50 text-amber-900'}`}>{statusText}</p>
    <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
      <Info label="선정 표현 / 주체" value={`${pick.selectionLabel} / ${report.institution}`} />
      <Info label="발행일" value={report.publishedOn} />
      <Info label="원문 섹터·테마" value={pick.sector ?? '미확인'} />
      <Info label="명시 투자 기간" value={pick.horizons.map(h => HORIZON_LABELS[h]).join(' · ')} />
      <Info label="데스크 / 작성자" value={`${report.desk} / ${report.authors.join(', ') || '미확인'}`} />
      <Info label="대조 시각 / 사용권" value={`${report.verifiedAt} / 미확인`} />
    </dl>
    <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">기간 분류 근거: {pick.horizonBasis}</p>
    {warnings.length > 0 ? <ul className="mt-3 list-inside list-disc space-y-1 rounded-lg bg-red-50 p-3 text-xs leading-5 text-red-900">{warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul> : null}
    <details className="mt-4 border-t border-slate-200 pt-3"><summary className={`cursor-pointer text-sm font-semibold text-blue-700 ${focusClass}`}>선정 근거와 원문 위치 보기</summary>
      <div className="mt-3 space-y-3 break-words text-xs leading-5">
        <p className="font-semibold">{report.title}</p><p>{pick.evidence}</p><p>원문 위치: {pick.locator}{pick.page !== null ? ` · PDF 페이지 ${pick.page}` : ''}</p>
        <p>자료 형태: {report.sourceKind === 'pdf' ? 'PDF' : '공식 웹페이지'} · 열람 참고: {report.accessNote ?? '외부 사이트 사정에 따라 로그인·접근 제한이 있을 수 있습니다.'}</p>
        <p className="break-all font-mono text-[11px]">원천 SHA-256: {report.sourceHash ?? '미확인 · 임시 해시를 만들지 않음'}</p>
        <p className="text-slate-500">선정 표현과 위치를 수동 대조한 기록입니다. 기관 의견을 앱의 투자 행동으로 변환하지 않습니다. 링크 제공은 복제·AI 처리·재배포 허가가 아닙니다.</p>
      </div>
    </details>
    <div className="mt-4">{href ? <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={`inline-block bg-blue-700 px-4 py-2 text-sm font-semibold text-white ${focusClass}`}>기관 원문 보기 ↗</a> : <button type="button" disabled className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-500">원문 링크 검증 보류</button>}</div>
  </article>;
}
function Info({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-1 break-words leading-5">{value}</dd></div>;
}
