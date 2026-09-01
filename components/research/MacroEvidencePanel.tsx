"use client";

import { useEffect, useRef, useState } from "react";
import { canApplyMacroResponse } from "@/lib/researchCopilot/macroEvidence/requestIsolation";
import { isMacroDashboardResult } from "@/lib/researchCopilot/macroEvidence/publicValidation";
import { KOREA_MACRO_ALLOWLIST } from "@/lib/researchCopilot/macroEvidence/koreaRegistry";
import { US_MACRO_ALLOWLIST } from "@/lib/researchCopilot/macroEvidence/usRegistry";
import type {
  MacroDashboardResult,
  MacroDerivedSeriesEvidence,
  MacroSectionId,
  MacroSeriesEvidence,
  MacroSeriesResult,
} from "@/lib/researchCopilot/macroEvidence/types";

export const MACRO_EVIDENCE_ENDPOINT = "/api/research/macro-evidence";

type LoadState =
  | { status: "loading"; identity: string }
  | { status: "ready"; identity: string; result: MacroDashboardResult }
  | { status: "blocked"; identity: string; message: string };

const SECTION_COPY: Record<MacroSectionId, { eyebrow: string; title: string; description: string }> = {
  "korea-macro": {
    eyebrow: "KOREA · OFFICIAL",
    title: "한국 거시",
    description: "ECOS allowlist로 확인한 기준금리·금리곡선·성장·물가·환율입니다.",
  },
  "us-rates": {
    eyebrow: "UNITED STATES · OFFICIAL",
    title: "미국 금리",
    description: "미 재무부 공식 금리곡선과 뉴욕연은 EFFR만 사용합니다.",
  },
  "credit-volatility": {
    eyebrow: "CREDIT & VOLATILITY",
    title: "신용·변동성",
    description: "동일 관측일의 국내 신용스프레드만 계산하고, 계약 데이터는 숫자를 표시하지 않습니다.",
  },
};

type ReadyMacroSeries = MacroSeriesEvidence | MacroDerivedSeriesEvidence;

function displayAvailability(item: ReadyMacroSeries) {
  const latest = item.latestObservation;
  return [
    ["발표일", latest.releaseDate ?? "원천 미제공"],
    ["빈티지", latest.vintageDate ?? "원천 미제공"],
    ["잠정·확정", latest.preliminaryFinal ?? "원천 미제공"],
    ["수정 상태", latest.revisionStatus ?? "원천 미제공"],
  ];
}

function ReadyCard({ item }: { item: ReadyMacroSeries }) {
  const derived = item.mode === "deterministic-derived";
  const koreaDefinition = !derived && item.seriesId in KOREA_MACRO_ALLOWLIST
    ? KOREA_MACRO_ALLOWLIST[item.seriesId as keyof typeof KOREA_MACRO_ALLOWLIST]
    : null;
  const usDefinition = !derived && item.seriesId in US_MACRO_ALLOWLIST
    ? US_MACRO_ALLOWLIST[item.seriesId as keyof typeof US_MACRO_ALLOWLIST]
    : null;
  return (
    <article className="min-w-0 rounded-xl border border-[#DCE4F5] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-sm font-black text-[#0F172A]">{item.title}</p>
          <p className="mt-1 text-[10px] text-[#64748B]">{item.provider} · {item.frequency}</p>
        </div>
        <span className="rounded-full bg-[#E8ECFF] px-2 py-1 text-[10px] font-bold text-[#1428A0]">
          {derived ? "공식 원천 · 결정론 계산" : "공식 실데이터"}
        </span>
      </div>
      <p className="mt-4 break-words text-2xl font-black text-[#1428A0]">
        {item.latestObservation.valueRaw} <span className="text-xs font-bold text-[#64748B]">{item.unit}</span>
      </p>
      <p className="mt-1 text-[11px] text-[#64748B]">
        {item.frequency === "D" ? "관측일" : "기준기간"} {item.frequency === "D" ? item.latestObservation.observationDate : item.latestObservation.observationDateRaw}
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
        {displayAvailability(item).map(([label, value]) => (
          <div key={label} className="min-w-0 rounded-lg bg-[#F5F7FC] p-2">
            <dt className="text-[#64748B]">{label}</dt>
            <dd className="mt-0.5 break-words font-bold text-[#0F172A]">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 border-t border-[#DCE4F5] pt-3 text-[10px] leading-relaxed text-[#64748B]">
        <p className="break-all">정의 {item.definitionVersion}</p>
        {koreaDefinition && (
          <p className="mt-1 break-words">ECOS STAT_CODE {koreaDefinition.statCode} · ITEM_CODE {koreaDefinition.itemCodes.join(", ")} · 주기 {koreaDefinition.frequency}</p>
        )}
        {usDefinition && <p className="mt-1 break-words">공식 필드 {usDefinition.sourceField} · 주기 {usDefinition.frequency}</p>}
        {derived && <p className="mt-1 break-words">산식 {item.formula}</p>}
        <p className="mt-1 break-all">수집 {item.retrievedAt}</p>
        <a
          href={item.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex min-h-9 items-center font-black text-[#1428A0] underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8]"
        >
          공식 원천 열기 ↗
        </a>
      </div>
    </article>
  );
}

function BlockedCard({ item }: { item: Extract<MacroSeriesResult, { status: "blocked" }> }) {
  const rightsOnly = item.code === "DATA_RIGHTS_REVIEW_REQUIRED";
  return (
    <article className={`min-w-0 rounded-xl border p-4 ${rightsOnly ? "border-[#DCE4F5] bg-[#F5F7FC]" : "border-red-200 bg-red-50"}`}>
      <p className={`text-xs font-black ${rightsOnly ? "text-[#1428A0]" : "text-red-700"}`}>
        {rightsOnly ? "데이터 이용권 확인 필요" : "공식 데이터 표시 차단"}
      </p>
      <h3 className="mt-1 break-words text-sm font-black text-[#0F172A]">{item.title}</h3>
      <p className={`mt-2 break-words text-xs leading-relaxed ${rightsOnly ? "text-[#64748B]" : "text-red-700"}`}>{item.message}</p>
      <p className="mt-2 break-all font-mono text-[9px] text-[#64748B]">상태 {item.code}</p>
      <a
        href={item.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex min-h-9 items-center text-[10px] font-black text-[#1428A0] underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8]"
      >
        권리·원천 확인 경로 ↗
      </a>
    </article>
  );
}

function SeriesCard({ item }: { item: MacroSeriesResult }) {
  return item.status === "ready" ? <ReadyCard item={item} /> : <BlockedCard item={item} />;
}

export default function MacroEvidencePanel({ identity }: { identity: string }) {
  const [state, setState] = useState<LoadState>({ status: "loading", identity });
  const [reloadGeneration, setReloadGeneration] = useState(0);
  const requestGenerationRef = useRef(0);
  const identityRef = useRef(identity);
  identityRef.current = identity;

  useEffect(() => {
    const controller = new AbortController();
    const expectedGeneration = ++requestGenerationRef.current;
    const expectedIdentity = identity;
    setState({ status: "loading", identity: expectedIdentity });

    void fetch(MACRO_EVIDENCE_ENDPOINT, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      const payload: unknown = await response.json().catch(() => null);
      if (!canApplyMacroResponse({
        aborted: controller.signal.aborted,
        expectedGeneration,
        actualGeneration: requestGenerationRef.current,
        expectedIdentity,
        actualIdentity: identityRef.current,
      })) return;
      if (!response.ok || !isMacroDashboardResult(payload)) {
        setState({ status: "blocked", identity: expectedIdentity, message: "공식 원천·단위·관측일·권리 상태를 모두 검증하지 못해 거시 데이터를 표시하지 않습니다." });
        return;
      }
      setState({ status: "ready", identity: expectedIdentity, result: payload });
    }).catch(() => {
      if (!canApplyMacroResponse({
        aborted: controller.signal.aborted,
        expectedGeneration,
        actualGeneration: requestGenerationRef.current,
        expectedIdentity,
        actualIdentity: identityRef.current,
      })) return;
      setState({ status: "blocked", identity: expectedIdentity, message: "공식 데이터 요청에 실패해 이전 값이나 교육용 값을 대신 표시하지 않습니다." });
    });

    return () => controller.abort();
  }, [identity, reloadGeneration]);

  const visibleState: LoadState = state.identity === identity ? state : { status: "loading", identity };

  return (
    <section aria-labelledby="macro-evidence-heading" className="space-y-4 rounded-2xl border border-[#C9D1FF] bg-[#EEF1FF] p-4 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-black uppercase tracking-wide text-[#1428A0]">MACRO EVIDENCE REGISTRY</p>
            <span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold text-[#1428A0]">fixture와 분리</span>
          </div>
          <h2 id="macro-evidence-heading" className="mt-1 text-lg font-black text-[#0F172A]">공식 거시·금리 근거판</h2>
          <p className="mt-1 max-w-4xl text-xs leading-relaxed text-[#64748B]">
            승인된 공식 원천의 숫자만 표시합니다. AI는 숫자를 만들거나 수정하지 않으며, 이 결과는 포트폴리오·상품추천·고객 출력에 자동 전달되지 않습니다.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setReloadGeneration((current) => current + 1)}
          className="min-h-11 shrink-0 rounded-lg border border-[#1428A0] bg-white px-4 text-xs font-black text-[#1428A0] hover:bg-[#F5F7FC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8] focus-visible:ring-offset-2"
        >
          공식 데이터 다시 확인
        </button>
      </div>

      {visibleState.status === "loading" && (
        <p role="status" aria-live="polite" className="rounded-xl bg-white p-4 text-sm font-semibold text-[#475569]">
          공식 원천 응답과 allowlist를 검증하고 있습니다.
        </p>
      )}

      {visibleState.status === "blocked" && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-black text-red-700">거시 Evidence 전체 표시 차단</p>
          <p className="mt-1 text-xs leading-relaxed text-red-700">{visibleState.message}</p>
        </div>
      )}

      {visibleState.status === "ready" && (
        <div className="space-y-4">
          {(["korea-macro", "us-rates", "credit-volatility"] as const).map((sectionId) => {
            const copy = SECTION_COPY[sectionId];
            const items = visibleState.result.sections[sectionId];
            return (
              <section key={sectionId} aria-labelledby={`macro-section-${sectionId}`} className="rounded-xl border border-[#DCE4F5] bg-white p-4">
                <p className="text-[10px] font-black tracking-wide text-[#2C3EE8]">{copy.eyebrow}</p>
                <h3 id={`macro-section-${sectionId}`} className="mt-1 text-base font-black text-[#0F172A]">{copy.title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-[#64748B]">{copy.description}</p>
                {items.length === 0 ? (
                  <p className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">검증된 계열이 없어 이 구역을 표시하지 않습니다.</p>
                ) : (
                  <div className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {items.map((item) => <SeriesCard key={item.seriesId} item={item} />)}
                  </div>
                )}
              </section>
            );
          })}
          <p className="text-[10px] leading-relaxed text-[#64748B]">
            수집 시각은 데이터 관측일·공표일과 다릅니다. 원천이 발표일·빈티지·잠정/확정·수정 상태를 제공하지 않으면 “원천 미제공”으로 보존하며 이를 임의 추론하지 않습니다.
          </p>
        </div>
      )}
    </section>
  );
}
