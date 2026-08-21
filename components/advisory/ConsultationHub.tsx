"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Client } from "@/lib/types";
import type { CalcResults, EvidenceBundle } from "@/lib/advisory/types";
import {
  applyCalcSnapshot,
  approveByPb,
  canLock,
  completeApprovalIfReady,
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

  /** review에 고착된 번들: Evidence 보강 후 locked까지 자동 진행 */
  useEffect(() => {
    if (recovering.current) return;
    let cancelled = false;

    const run = async () => {
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
            body: JSON.stringify({ client }),
          });
          const data = await res.json();
          if (!cancelled && data.ok && data.snap) {
            current = applyCalcSnapshot(current, data.snap);
            // applyCalcSnapshot이 review+canLock이면 이미 locked
          }
        }
        if (!cancelled && current.status !== "locked" && current.status !== "blocked") {
          if (current.status === "review" && canLock(current)) {
            current = approveByPb(current, "PB");
          } else if (canLock(current) && current.status === "draft" && client.stages?.portfolio) {
            // 하위 단계만 끝난 draft: 한 번 승인으로 locked
            current = completeApprovalIfReady(current, "PB");
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
  }, [client.id, client.stages?.portfolio]);

  const stuck = bundle.status === "review" || (!canLock(bundle) && softLockReasons(bundle).length > 0);
  const [open, setOpen] = useState(stuck);
  useEffect(() => {
    if (stuck) setOpen(true);
  }, [stuck]);

  const steps = useMemo(() => buildPipeline(client, bundle), [client, bundle]);
  const results: CalcResults | null = bundle.calcResults;

  return (
    <div className="space-y-3">
      <ConsultationPipelineBar
        steps={steps}
        statusLabel={`bundle.status=${bundle.status} · ${ADVISORY_STATUS_LABEL[bundle.status]}`}
      />
      <ControlStatusBar
        bundle={bundle}
        client={client}
        onChange={persist}
      />
      <button
        type="button"
        className="text-xs font-semibold text-[#1428A0] hover:underline"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Evidence · Judge · 리스크 패널 접기" : "Evidence Bundle · Judge 신뢰도 · 리스크/워터폴 열기"}
      </button>
      {open && (
        <>
          {results && <RiskAndWaterfallPanel results={results} />}
          <EvidenceBundlePanel
            bundle={bundle}
            client={client}
            onChange={persist}
          />
          <JudgeTrustPanel />
        </>
      )}
    </div>
  );
}
