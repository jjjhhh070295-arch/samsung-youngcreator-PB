"use client";

import { useState } from "react";
import type { Client } from "@/lib/types";
import type { EvidenceBundle, RecommendResult } from "@/lib/advisory/types";
import { PRODUCT_CATEGORY_LABEL } from "@/lib/advisory/types";
import { appendRun, applyJudge, loadBundle, saveBundle } from "@/lib/advisory/control";
import ControlStatusBar from "./ControlStatusBar";
import EvidenceBundlePanel from "./EvidenceBundlePanel";

export default function ProductRecommendPanel({ client }: { client: Client }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RecommendResult | null>(null);
  const [bundle, setBundle] = useState<EvidenceBundle>(() => loadBundle(client.id));
  const [error, setError] = useState("");

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/advisory/recommend", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client, constraintText: text }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "추천 실패");
      setResult(data.result as RecommendResult);
      let next = loadBundle(client.id);
      next = appendRun(next, {
        kind: "recommend",
        engine: "deterministic-catalog",
        inputHash: data.bundle.inputHash,
        outputHash: data.bundle.outputHash,
        notes: data.bundle.runs?.[0]?.notes ?? "상품 추천 산출",
      });
      next = applyJudge(next, data.judge, "engine");
      saveBundle(next);
      setBundle(next);
    } catch (e: any) {
      setError(e?.message ?? "추천을 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <ControlStatusBar bundle={bundle} onChange={(b) => { saveBundle(b); setBundle(b); }} />
      <div className="card p-4">
        <p className="text-sm font-bold text-fg">고객 맞춤 상품 추천</p>
        <p className="mt-1 text-xs text-fg-muted">
          상담메모 · 현금흐름표 · RRTTLLU · 투자성향 · 세금일정을 결정론 엔진이 반영합니다.
          비중·세금·VaR/CVaR는 확정하지 않습니다. “신탁만 고려”, “해외주식만, 기대수익률 20% 이상, 개별주식 선호”처럼 조건을 넣으면 A/B/C안 모두 같은 제약을 따릅니다.
        </p>
        <textarea
          className="input mt-3 min-h-[88px]"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="예: 신탁만 고려 / 해외주식만, 기대수익률 20% 이상, 개별주식 선호"
        />
        <button className="btn-primary mt-3" onClick={run} disabled={busy}>
          {busy ? "엔진 계산 중…" : "A/B/C안 산출"}
        </button>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>

      {result && (
        <>
          <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-fg-muted">
            as-of {result.asOf} · {result.source} · {result.currency}
            {result.constraints.tags.length > 0 && (
              <span className="ml-2 text-[#1428A0] font-semibold">조건: {result.constraints.tags.join(" · ")}</span>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            {result.plans.map((plan) => (
              <div key={plan.id} className="card p-4">
                <div className="mb-2 flex items-center justify-between">
                  <p className="font-bold text-fg">{plan.label}</p>
                  <span className="rounded-full bg-[#1428A0] px-2 py-0.5 text-[10px] text-white">{plan.posture}</span>
                </div>
                <p className="mb-3 text-[11px] text-fg-muted">{plan.constraintNote}</p>
                <ul className="space-y-3">
                  {plan.products.map((p) => (
                    <li key={`${plan.id}-${p.name}`} className="border-t border-border pt-2 first:border-0 first:pt-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-fg">{p.name}</p>
                        <span className="text-[10px] text-fg-muted">{PRODUCT_CATEGORY_LABEL[p.category]}</span>
                      </div>
                      <p className="text-[11px] text-fg-muted">{p.role} · {p.suggestedWeightRange} (미확정)</p>
                      <p className="mt-1 text-[11px] text-fg">{p.fitReason}</p>
                      {p.expectedReturnPct && (
                        <p className="text-[10px] text-fg-muted">
                          proxy {p.expectedReturnPct.value}% · as-of {p.expectedReturnPct.asOf.slice(0, 10)} · {p.expectedReturnPct.source}
                        </p>
                      )}
                      <p className="text-[10px] text-fg-muted">위험: {p.riskNote}</p>
                      <p className="text-[10px] text-fg-muted">세금: {p.taxNote}</p>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[10px] leading-relaxed text-fg-muted">{plan.weightDisclaimer}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-fg-muted">{result.disclaimers.join(" ")}</p>
        </>
      )}

      <EvidenceBundlePanel bundle={bundle} />
    </div>
  );
}
