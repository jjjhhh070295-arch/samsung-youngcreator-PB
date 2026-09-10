"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AnalyticsResult } from "@/lib/portfolioAnalytics/types";
import { assumptionKey, parsePBAssumption, type PBAssumptions } from "@/lib/portfolioAnalytics/pbScenario";

export default function PortfolioEvidenceWarning({ holdings, coverage, assumptions, onApply, promptEnabled = true }: {
  holdings: AnalyticsResult["holdings"]; coverage: number; assumptions: PBAssumptions; onApply: (values: PBAssumptions) => void;
  /** false 면 근거 부족 종목이 있어도 모달을 자동으로 열지 않는다(열려 있으면 닫는다). 배너 버튼으로는 언제든 연다. */
  promptEnabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [drafts, setDrafts] = useState<Record<string, { rate: string; reason: string }>>({});
  const [error, setError] = useState("");
  // 모달은 document.body 로 portal 한다. 이 컴포넌트는 포트폴리오 3단계 영역 안에 붙어 있고,
  // 2단계에서는 그 영역이 display:none 이다. 그 안에서 showModal() 을 부르면 모달은 0×0 으로
  // 보이지 않는데 페이지 전체는 모달에 막혀, 클릭·입력·Esc 가 모두 먹지 않았다("그냥 멈춘다").
  // body 로 빼면 어느 단계에서 열리든 실제로 보인다. 서버 렌더에는 document 가 없으므로 마운트 후에 붙인다.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => { setPortalTarget(document.body); }, []);
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
  // 자동으로 띄운 마지막 조합. 2단계에서 보고 닫은 뒤 3단계로 넘어가도 같은 조합이면 다시 끼어들지 않는다.
  // 자동 오픈이 꺼진 동안(1단계)에는 기록하지 않아, 2단계에 들어서는 순간 한 번 뜬다.
  const promptedSignature = useRef<string | null>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (!promptEnabled) {
      if (element.open) element.close();
      return;
    }
    if (promptedSignature.current === signature) return;
    promptedSignature.current = signature;
    if (!element.open) element.showModal();
  }, [signature, promptEnabled, portalTarget]);
  useEffect(() => {
    const element = dialog.current;
    return () => { element?.close(); };
  }, [portalTarget]);
  return <>
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
      <p>근거가 부족한 종목이 있어 PB 입력이 필요합니다. 추정 가능한 자산 비중: {(coverage * 100).toFixed(1)}%</p>
      <button type="button" className="mt-2 font-bold underline" onClick={() => { setDrafts({}); setError(""); dialog.current?.showModal(); }}>근거 부족 종목 확인 · PB 가정 입력</button>
    </div>
    {portalTarget && createPortal(
    <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId} className="m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-2xl border border-amber-200 bg-white p-5 text-fg shadow-xl backdrop:bg-black/40">
      <h3 id={titleId} className="text-lg font-black text-amber-800">기대수익률 산출 근거가 부족합니다</h3>
      <p id={descriptionId} className="mt-3 text-sm leading-relaxed">아래 종목은 기대수익률을 산출할 데이터가 부족합니다. PB가 직접 연 기대수익률과 근거를 입력하면 메인 포트폴리오 지표에 즉시 반영됩니다.</p>
      <p className="mt-2 text-sm">수익률은 포트폴리오 기준통화 기준으로 입력하세요.</p>
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
      <p className="text-xs text-fg-muted">MDD·변동성은 기대수익률에서 임의 추정하지 않고, 확보된 실제 가격 데이터로 계산합니다.</p>
      <p className="mt-1 text-xs text-fg-muted">PB 가정은 현재 화면에서만 유지되며 새로고침 시 초기화됩니다.</p>
      <div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" autoFocus className="rounded-lg border border-border px-4 py-2 text-sm" onClick={() => dialog.current?.close()}>입력 없이 닫기</button><button type="button" className="btn-primary px-5 py-2 text-sm" onClick={apply}>입력값을 메인 지표에 반영</button></div>
    </dialog>,
    portalTarget)}
  </>;
}
