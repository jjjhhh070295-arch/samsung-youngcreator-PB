"use client";

import type { PipelineStep } from "@/lib/advisory/types";
import { AI_ROLE_COPY, ENGINE_ROLE_COPY, HONESTY_LIMITS } from "@/lib/advisory/constants";

const TONE: Record<PipelineStep["state"], string> = {
  complete: "bg-[#1428A0] text-white",
  review: "bg-amber-500 text-white",
  blocked: "bg-red-600 text-white",
  pending: "bg-surface-2 text-fg-muted",
};

const LABEL: Record<PipelineStep["state"], string> = {
  complete: "완료",
  review: "검토필요",
  blocked: "차단",
  pending: "대기",
};

export default function ConsultationPipelineBar({
  steps,
  currentLabel,
}: {
  steps: PipelineStep[];
  currentLabel?: string;
}) {
  const current = steps.find((s) => s.state === "review" || s.state === "blocked") ?? steps.find((s) => s.state === "pending") ?? steps[steps.length - 1];
  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-fg-muted">상담 파이프라인</p>
          <p className="text-sm font-bold text-fg">
            현재 단계: {currentLabel ?? current?.label} · {current ? LABEL[current.state] : ""}
          </p>
        </div>
        <p className="max-w-xl text-[11px] leading-relaxed text-fg-muted">
          {AI_ROLE_COPY} {ENGINE_ROLE_COPY}
        </p>
      </div>
      <ol className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-stretch">
        {steps.map((s, i) => (
          <li key={s.id} className="flex min-w-0 flex-1 items-stretch gap-2">
            <div className={`rounded-lg px-3 py-2 ${TONE[s.state]}`}>
              <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
                {i + 1}. {LABEL[s.state]}
              </p>
              <p className="text-xs font-bold">{s.label}</p>
              <p className="mt-0.5 text-[10px] leading-snug opacity-90">{s.note}</p>
            </div>
            {i < steps.length - 1 && <span className="hidden self-center text-fg-muted lg:inline">→</span>}
          </li>
        ))}
      </ol>
      <ul className="grid grid-cols-1 gap-1 text-[10px] text-fg-muted md:grid-cols-2">
        {HONESTY_LIMITS.map((line) => (
          <li key={line}>· {line}</li>
        ))}
      </ul>
    </div>
  );
}
