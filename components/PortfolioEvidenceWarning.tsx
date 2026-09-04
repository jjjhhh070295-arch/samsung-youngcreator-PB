"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { AnalyticsResult } from "@/lib/portfolioAnalytics/types";
import { assumptionKey, parsePBAssumption, type PBAssumptions } from "@/lib/portfolioAnalytics/pbScenario";

export default function PortfolioEvidenceWarning({ holdings, coverage, assumptions, onApply }: {
  holdings: AnalyticsResult["holdings"]; coverage: number; assumptions: PBAssumptions; onApply: (values: PBAssumptions) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [drafts, setDrafts] = useState<Record<string, { rate: string; reason: string }>>({});
  const [error, setError] = useState("");
  const draftFor = (key: string) => drafts[key] ?? { rate: assumptions[key] ? String(Number((assumptions[key].value * 100).toFixed(8))) : "", reason: assumptions[key]?.reason ?? "" };
  const apply = () => {
    try {
      const next: PBAssumptions = {};
      for (const h of holdings) {
        const key = assumptionKey(h), draft = draftFor(key);
        try { next[key] = parsePBAssumption(draft.rate, draft.reason); }
        catch (e) { throw new Error(`${h.name}: ${e instanceof Error ? e.message : "입력값을 확인하세요."}`); }
      }
      onApply(next); setError(""); dialog.current?.close();
    } catch (e) { setError(e instanceof Error ? e.message : "입력값을 확인하세요."); }
  };
  // Weight/period edits with the same unresolved evidence must not repeatedly
  // interrupt the PB. New affected holdings/reasons open a fresh warning.
  const signature = JSON.stringify(holdings.map(h => [h.ticker, h.expectedReturn.assumptions]).sort());
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => { element?.close(); };
  }, [signature]);
  return <>
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <p>근거가 부족한 종목이 있어 전체 기대수익률을 산출하지 않았습니다. 추정 가능한 자산 비중: {(coverage * 100).toFixed(1)}%</p>
      <button type="button" className="mt-2 font-bold underline" onClick={() => { setDrafts({}); setError(""); dialog.current?.showModal(); }}>근거 부족 종목 확인 · PB 가정 입력</button>
    </div>
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId} className="m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-amber-200 bg-white p-5 text-fg shadow-xl backdrop:bg-black/40">
      <h3 id={titleId} className="text-lg font-black text-amber-800">기대수익률 산출 근거가 부족합니다</h3>
      <p id={descriptionId} className="mt-3 text-sm leading-relaxed">아래 종목은 기대수익률을 산출할 데이터가 부족합니다. 임시 가정값으로 채우지 않으며, 전체 포트폴리오 기대수익률도 산출을 보류합니다.</p>
      <p className="mt-2 text-sm">PB가 직접 연 기대수익률과 근거를 입력하면 <strong>PB 가정 기반 시나리오</strong>로 별도 계산할 수 있습니다. 수익률은 포트폴리오 기준통화 기준으로 입력하세요.</p>
      <ul className="my-4 space-y-3">{holdings.map((h, i) => <li key={`${h.ticker}-${i}`} className="rounded-lg bg-amber-50 p-3 text-sm">
        <p className="font-bold">{h.name} ({h.ticker}) · 비중 {(h.weight * 100).toFixed(1)}%</p>
        <p className="mt-1 text-xs leading-relaxed text-amber-900">{h.expectedReturn.assumptions.join(" ")}</p>
        <label className="mt-3 block text-xs font-bold">{h.name} 연 기대수익률 (%)
          <input type="number" min="-100" max="1000" step="any" placeholder="직접 입력" className="mt-1 w-full rounded border border-border bg-white p-2 text-sm" value={draftFor(assumptionKey(h)).rate}
            onChange={e => setDrafts(d => ({ ...d, [assumptionKey(h)]: { ...draftFor(assumptionKey(h)), rate: e.target.value } }))} />
        </label>
        <label className="mt-2 block text-xs font-bold">{h.name} 가정 근거
          <textarea maxLength={500} rows={2} placeholder="판단 근거 또는 참고 자료를 입력하세요" className="mt-1 w-full rounded border border-border bg-white p-2 text-sm" value={draftFor(assumptionKey(h)).reason}
            onChange={e => setDrafts(d => ({ ...d, [assumptionKey(h)]: { ...draftFor(assumptionKey(h)), reason: e.target.value } }))} />
        </label>
      </li>)}</ul>
      {error && <p role="alert" className="mb-3 text-sm text-rose-700">{error}</p>}
      <p className="text-xs text-fg-muted">과거 CAGR·MDD·변동성은 확보된 실제 가격 데이터 범위에서 별도로 계산합니다.</p>
      <p className="mt-1 text-xs text-fg-muted">PB 가정은 현재 화면에서만 유지되며 새로고침 시 초기화됩니다.</p>
      <div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" autoFocus className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => dialog.current?.close()}>입력 없이 닫기</button><button type="button" className="btn-primary px-5 py-2 text-sm" onClick={apply}>PB 가정으로 별도 계산</button></div>
    </dialog>
  </>;
}
