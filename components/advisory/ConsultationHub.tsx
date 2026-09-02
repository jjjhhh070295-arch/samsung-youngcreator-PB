"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Client } from "@/lib/types";
import { getLoggedInPbSession } from "@/lib/auth";
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
import ConsultationPipelineBar from "./ConsultationPipelineBar";
import ControlStatusBar from "./ControlStatusBar";
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
      const session = await getLoggedInPbSession();
      if (cancelled) return;
      const assignedPbDisplay = session?.pbId === client.assignedPbId
        ? session.pbName
        : "권한 확인 필요";
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

  /** 계산 기록이 부족한 검토본을 자동 보강하되, 사람의 PB 상담 검토 승인은 자동화하지 않는다. */
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
  const reviewReady = bundle.status === "locked" || canLock(bundle);
  const recordReady = Boolean(bundle.runId && bundle.settingsHash && (bundle.resultHash || bundle.outputHash));

  return (
    <div className="space-y-3">
      <ConsultationPipelineBar
        steps={steps}
        clientName={client.name}
        bundle={bundle}
      />
      <section className="decision-card border-[#1428A0]/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="decision-kicker">상담 검토</p>
            <h3 className="decision-title mt-1">
              {bundle.status === "locked" ? "고객 제안 확정 완료" : reviewReady ? "확정 준비 완료" : "PB 검토 진행 중"}
            </h3>
            <p className="decision-copy mt-1">
              상담 원문, 입력값, 계산 결과를 기준으로 문서 발행 가능 여부를 확인합니다.
            </p>
          </div>
          <span className={reviewReady && recordReady ? "badge-success" : "badge-warning"}>
            {bundle.status === "locked" ? "확정 완료" : reviewReady && recordReady ? "승인 가능" : "검토 필요"}
          </span>
        </div>
        <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <span className={bundle.citation?.passed ? "badge-success" : "badge-muted"}>고객 적합성 검증 {bundle.citation?.passed ? "완료" : "대기"}</span>
          <span className={bundle.updatedAt ? "badge-success" : "badge-muted"}>데이터 최신성 확인</span>
          <span className={results ? "badge-success" : "badge-muted"}>리스크 검증 {results ? "완료" : "대기"}</span>
          <span className={recordReady ? "badge-success" : "badge-muted"}>계산 기록 {recordReady ? "확인" : "대기"}</span>
        </div>
        <button
          type="button"
          className="btn-outline mt-4 text-xs"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="advisory-calculation-panels"
        >
          {open ? "리스크·세후 계산 접기" : "리스크·세후 계산 보기"}
        </button>
      </section>
      <ControlStatusBar
        bundle={bundle}
        client={client}
        inputContext={inputContext}
        onChange={persist}
      />
      {open && (
        <div id="advisory-calculation-panels" className="space-y-3">
          {results && <RiskAndWaterfallPanel results={results} />}
        </div>
      )}
    </div>
  );
}
