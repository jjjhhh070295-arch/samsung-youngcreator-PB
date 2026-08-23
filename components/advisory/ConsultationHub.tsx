"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Client } from "@/lib/types";
import { listPbs } from "@/lib/store";
import type { CalcResults, EvidenceBundle } from "@/lib/advisory/types";
import type { AdvisoryInputContext } from "@/lib/advisory/integrity";
import {
  applyCalcSnapshot,
  canLock,
  loadBundle,
  saveBundle,
  softLockReasons,
} from "@/lib/advisory/control";
import { buildPipeline } from "@/lib/advisory/pipeline";
import { ADVISORY_STATUS_LABEL } from "@/lib/advisory/types";
import ConsultationPipelineBar from "./ConsultationPipelineBar";
import ControlStatusBar from "./ControlStatusBar";
import EvidenceBundlePanel from "./EvidenceBundlePanel";
import JudgeTrustPanel from "./JudgeTrustPanel";
import RiskAndWaterfallPanel from "./RiskAndWaterfallPanel";

export default function ConsultationHub({ client }: { client: Client }) {
  const [bundle, setBundle] = useState<EvidenceBundle>(() => loadBundle(client.id));
  const [inputContextState, setInputContextState] = useState<{
    sourcePbId: string;
    value: AdvisoryInputContext;
  } | null>(null);
  const inputContext =
    inputContextState?.sourcePbId === client.assignedPbId ? inputContextState.value : null;
  const recovering = useRef(false);

  const persist = (next: EvidenceBundle) => {
    saveBundle(next);
    setBundle(next);
    window.dispatchEvent(new Event("pb-evidence-updated"));
  };

  useEffect(() => {
    setBundle(loadBundle(client.id));
    const reload = () => setBundle(loadBundle(client.id));
    window.addEventListener("pb-evidence-updated", reload);
    return () => window.removeEventListener("pb-evidence-updated", reload);
  }, [client.id]);

  useEffect(() => {
    let cancelled = false;
    const loadInputContext = async () => {
      const pbs = await listPbs();
      if (cancelled) return;
      const assignedPbDisplay = pbs.find((pb) => pb.id === client.assignedPbId)?.name ?? "미지정";
      setInputContextState({
        sourcePbId: client.assignedPbId,
        value: { assignedPbDisplay },
      });
    };
    void loadInputContext();
    return () => {
      cancelled = true;
    };
  }, [client.assignedPbId]);

  /** Evidence가 부족한 번들을 자동 보강하되, 사람의 PB 상담 검토 승인은 자동화하지 않는다. */
  useEffect(() => {
    if (recovering.current) return;
    let cancelled = false;

    const run = async () => {
      if (!inputContext) return;
      let current = loadBundle(client.id);
      if (current.status === "locked" || current.status === "blocked") return;
      // draft에서 포트폴리오까지 끝났거나, 이미 review면 복구 대상
      const shouldRecover =
        current.status === "review" ||
        (!!client.stages?.portfolio && current.status === "draft" && softLockReasons(current).length > 0);
      if (!shouldRecover) return;

      recovering.current = true;
      try {
        if (!canLock(current) && softLockReasons(current).length > 0) {
          const res = await fetch("/api/advisory/evidence", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ client, inputContext }),
          });
          const data = await res.json();
          if (!cancelled && data.ok && data.snap) {
            // 요청 중 PB가 승인했을 수 있으므로 응답 시점의 최신본을 다시 읽는다.
            // stale draft/review로 locked 승인을 덮어쓰지 않는다.
            const latest = loadBundle(client.id);
            if (latest.status === "locked" || latest.status === "blocked") return;
            current = applyCalcSnapshot(latest, data.snap);
          }
        }
        if (!cancelled) persist(current);
      } catch {
        /* 네트워크 실패 시 CTA로 수동 진행 */
      } finally {
        recovering.current = false;
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [client, inputContext]);

  const stuck = bundle.status === "review" || (!canLock(bundle) && softLockReasons(bundle).length > 0);
  const [open, setOpen] = useState(stuck);
  useEffect(() => {
    if (stuck) setOpen(true);
  }, [stuck]);

  const steps = useMemo(() => buildPipeline(client, bundle), [client, bundle]);
  const results: CalcResults | null = bundle.calcResults;
  const judgePassed = bundle.judge?.passed === true;
  const evidenceReady = Boolean(bundle.runId && bundle.settingsHash && (bundle.resultHash || bundle.outputHash));

  return (
    <div className="space-y-3">
      <ConsultationPipelineBar
        steps={steps}
        clientName={client.name}
        bundle={bundle}
        statusLabel={`bundle.status=${bundle.status} · ${ADVISORY_STATUS_LABEL[bundle.status]}`}
      />
      <section className="decision-card border-[#1428A0]/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="decision-kicker">AI · System · PB</p>
            <h3 className="decision-title mt-1">{judgePassed ? "AI 검증 완료" : "AI 검증 진행 중"}</h3>
            <p className="decision-copy mt-1">신뢰도: {judgePassed && evidenceReady ? "높음" : "검토 필요"} · 원문과 검증 로그는 언제든 확인할 수 있습니다.</p>
          </div>
          <span className={judgePassed ? "badge-success" : "badge-warning"}>{bundle.judge ? `Judge ${judgePassed ? "통과" : "실패"}` : "Judge 대기"}</span>
        </div>
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <span className={bundle.citation?.passed ? "badge-success" : "badge-muted"}>고객 적합성 검증 {bundle.citation?.passed ? "완료" : "대기"}</span>
          <span className={bundle.updatedAt ? "badge-success" : "badge-muted"}>데이터 최신성 확인</span>
          <span className={results ? "badge-success" : "badge-muted"}>리스크 검증 {results ? "완료" : "대기"}</span>
          <span className={evidenceReady ? "badge-success" : "badge-muted"}>계산 재현성 {evidenceReady ? "확인" : "대기"}</span>
        </div>
        <button
          type="button"
          className="btn-outline mt-4 text-xs"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="advisory-evidence-panels"
        >
          {open ? "상세 검증 로그 접기" : "추천 근거 · 상세 검증 로그 보기"}
        </button>
      </section>
      <ControlStatusBar
        bundle={bundle}
        client={client}
        inputContext={inputContext}
        onChange={persist}
      />
      {open && (
        <div id="advisory-evidence-panels" className="space-y-3">
          {results && <RiskAndWaterfallPanel results={results} />}
          <EvidenceBundlePanel
            bundle={bundle}
            client={client}
            inputContext={inputContext}
            onChange={persist}
          />
          <JudgeTrustPanel />
        </div>
      )}
    </div>
  );
}
