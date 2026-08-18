"use client";

import { useEffect, useMemo, useState } from "react";
import type { Client } from "@/lib/types";
import type { CalcResults, EvidenceBundle } from "@/lib/advisory/types";
import { loadBundle, saveBundle } from "@/lib/advisory/control";
import { buildPipeline } from "@/lib/advisory/pipeline";
import ConsultationPipelineBar from "./ConsultationPipelineBar";
import ControlStatusBar from "./ControlStatusBar";
import EvidenceBundlePanel from "./EvidenceBundlePanel";
import JudgeTrustPanel from "./JudgeTrustPanel";
import RiskAndWaterfallPanel from "./RiskAndWaterfallPanel";

export default function ConsultationHub({ client }: { client: Client }) {
  const [bundle, setBundle] = useState<EvidenceBundle>(() => loadBundle(client.id));

  useEffect(() => {
    setBundle(loadBundle(client.id));
    const reload = () => setBundle(loadBundle(client.id));
    window.addEventListener("pb-evidence-updated", reload);
    return () => window.removeEventListener("pb-evidence-updated", reload);
  }, [client.id]);

  const [open, setOpen] = useState(false);
  const steps = useMemo(() => buildPipeline(client, bundle), [client, bundle]);
  const results: CalcResults | null = bundle.calcResults;

  return (
    <div className="space-y-3">
      <ConsultationPipelineBar steps={steps} />
      <ControlStatusBar
        bundle={bundle}
        onChange={(next) => {
          saveBundle(next);
          setBundle(next);
        }}
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
            onChange={(next) => {
              saveBundle(next);
              setBundle(next);
            }}
          />
          <JudgeTrustPanel />
        </>
      )}
    </div>
  );
}
