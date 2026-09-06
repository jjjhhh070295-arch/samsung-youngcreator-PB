"use client";

import { useState } from "react";
import { filterResearchSources, getResearchSourceHref, KIND_LABELS, type ResearchSourceKind } from "@/lib/researchLinks/catalog";

/** Deliberately isolated from auth, customer stores, report ingestion and approvals. */
export default function ResearchLinkDirectory() {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<ResearchSourceKind | "all">("all");
  const sources = filterResearchSources(query, kind);

  return (
    <section aria-labelledby="research-links-title" className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <header className="space-y-3">
        <p className="text-sm font-semibold text-[#1428A0]">RESEARCH DIRECTORY</p>
        <h1 id="research-links-title" className="text-2xl font-bold text-fg sm:text-3xl">스몰캡 리서치 찾기</h1>
        <p className="max-w-3xl text-sm leading-6 text-fg-muted">중소형주 보고서를 발행자 사이트에서 직접 찾아보세요. 독립 리서치와 기관·증권사를 구분한 링크 모음이며, 전체 기관을 망라하거나 보고서 품질을 보증하는 목록은 아닙니다.</p>
      </header>

      <aside aria-label="이용 범위" className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-6 text-slate-800">
        <p className="font-semibold">기관 링크만 제공합니다 · 보고서 본문 수집 및 AI 분석 없음</p>
        <p>버튼을 누르면 외부 사이트가 새 탭에서 열립니다. 구독·로그인이 필요할 수 있으며 계정은 각 사이트에서 직접 사용하세요. 경로 확인은 저장·재배포·고객 제공 권리 승인을 뜻하지 않습니다.</p>
      </aside>

      <div className="grid gap-4 sm:grid-cols-[1fr_16rem]">
        <div>
          <label htmlFor="research-source-search" className="mb-1 block text-sm font-semibold text-fg">기관명·자료 종류 검색</label>
          <input id="research-source-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="예: 그로쓰, 밸류파인더, 탐방" className="w-full rounded-lg border border-border bg-surface p-3 text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1428A0]" />
        </div>
        <div>
          <label htmlFor="research-source-kind" className="mb-1 block text-sm font-semibold text-fg">기관 구분</label>
          <select id="research-source-kind" value={kind} onChange={(event) => setKind(event.target.value as ResearchSourceKind | "all")} className="w-full rounded-lg border border-border bg-surface p-3 text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1428A0]">
            <option value="all">전체</option>
            <option value="independent">독립 리서치</option>
            <option value="institution">기관·배포 포털</option>
            <option value="broker">증권사 리서치</option>
          </select>
        </div>
      </div>

      <p role="status" aria-live="polite" className="text-sm text-fg-muted">{sources.length}개 기관 · 표시 순서는 투자 추천 순위가 아닙니다.</p>
      {sources.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-6 text-fg">
          <p>검색 결과가 없습니다. 기관명을 줄여서 검색하거나 필터를 초기화하세요.</p>
          <button type="button" onClick={() => { setQuery(""); setKind("all"); }} className="mt-3 rounded-md border border-border px-4 py-2 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1428A0]">검색 초기화</button>
        </div>
      ) : (
        <ul className="grid list-none gap-4 p-0 md:grid-cols-2">
          {sources.map((source) => {
            const href = getResearchSourceHref(source);
            return (
              <li key={source.id} className="flex min-w-0 flex-col rounded-xl border border-border bg-surface p-5">
                <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-surface-2 px-2.5 py-1 text-fg-muted">{KIND_LABELS[source.kind]}</span>
                  <span className={href ? "text-emerald-700" : "text-amber-800"}>{href ? "공식 경로 확인" : "확인 필요 · 이동 보류"}</span>
                </div>
                <h2 className="text-lg font-bold text-fg">{source.name}</h2>
                <p className="mt-2 text-sm text-fg">{source.description}</p>
                <p className="mb-4 mt-2 text-sm leading-6 text-fg-muted">{source.accessNote}</p>
                <div className="mt-auto space-y-3">
                  <p className="text-xs text-fg-muted">{source.verifiedOn ? `경로 수동 확인일: ${source.verifiedOn} · 실시간 상태 아님` : "현재 공식 열람 경로 미확인"}</p>
                  {href ? <a href={href} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" aria-label={`${source.name} 원 사이트 열기 (새 탭)`} className="inline-flex min-h-11 items-center rounded-lg bg-[#1428A0] px-4 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1428A0] focus-visible:ring-offset-2">원 사이트 열기 ↗</a> : <p className="text-sm font-semibold text-amber-800">공식 주소 확인 후 연결합니다</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <footer className="border-t border-border pt-4 text-xs leading-6 text-fg-muted">기관의 분석과 PB의 판단은 별개입니다. 이 화면은 고객 정보·포트폴리오·상품 추천을 읽거나 변경하지 않으며, 고객 전달 기능이 없습니다.</footer>
    </section>
  );
}
