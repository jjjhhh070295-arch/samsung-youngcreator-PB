"use client";

import type { EvidenceBundle, PipelineStep } from "@/lib/advisory/types";
import { AI_ROLE_COPY, ENGINE_ROLE_COPY, HONESTY_LIMITS } from "@/lib/advisory/constants";
import { currentPipelineStep } from "@/lib/advisory/pipeline";

const TONE: Record<PipelineStep["state"], string> = {
  complete: "border-[#1428A0] bg-[#1428A0] text-white",
  review: "border-[#2C3EE8] bg-[#EEF1FF] text-[#0F1E7A] ring-2 ring-[#2C3EE8]/20",
  blocked: "border-red-200 bg-red-50 text-red-800",
  pending: "border-border bg-surface-2 text-fg-muted",
};

const LABEL: Record<PipelineStep["state"], string> = {
  complete: "완료",
  review: "검토필요",
  blocked: "고객 제안 차단",
  pending: "대기",
};

export default function ConsultationPipelineBar({
  steps,
  clientName,
  bundle,
  currentLabel,
  statusLabel,
}: {
  steps: PipelineStep[];
  clientName: string;
  bundle: EvidenceBundle;
  currentLabel?: string;
  statusLabel?: string;
}) {
  const current = currentPipelineStep(steps);
  const completeCount = steps.filter((step) => step.state === "complete").length;
  const approveStep = steps.find((s) => s.id === "approve");
  const needsApprove = approveStep?.state !== "complete" && bundle.status !== "blocked";

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="decision-kicker">Human-in-the-loop</p>
          <p className="decision-title mt-1">{clientName} 고객 상담 · {completeCount} / {steps.length} 단계 완료</p>
          <p className="mt-1 text-sm font-semibold text-fg">
            현재 단계: {currentLabel ?? current?.label} · {current ? LABEL[current.state] : ""}
            {statusLabel ? <span className="ml-2 text-xs font-semibold text-[#1428A0]">({statusLabel})</span> : null}
          </p>
        </div>
        <p className="hidden max-w-xl text-[11px] leading-relaxed text-fg-muted xl:block">
          {AI_ROLE_COPY} {ENGINE_ROLE_COPY}
        </p>
      </div>

      {needsApprove && (
        <div className="rounded-xl border-2 border-[#1428A0] bg-[#EEF1FF] p-4 shadow-sm [color-scheme:light]">
          <p className="text-sm font-bold text-[#0F1E7A]">3단계 PB 상담 검토 승인 필요</p>
          <p className="mt-1 text-[11px] leading-relaxed text-[#334155]">
            이 파이프라인은 진행상태만 보여줍니다. 바로 아래 상태 패널의 단일 행동 버튼에서 Evidence 생성과 PB 상담 검토 승인을 서로 다른 클릭으로 순서대로 진행합니다.
          </p>
        </div>
      )}

      <ol className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-stretch">
        {steps.map((s, i) => (
          <li key={s.id} className="flex min-w-0 flex-1 items-stretch gap-2">
            <div
              className={`w-full rounded-lg px-3 py-2 ${TONE[s.state]} ${
                current?.id === s.id ? "ring-2 ring-offset-1 ring-[#2C3EE8]" : ""
              }`}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
                {i + 1}. {s.state === "blocked" ? "🔒 " : ""}{LABEL[s.state]}
              </p>
              <p className="text-xs font-bold">{s.label}</p>
              <p className="mt-0.5 text-[10px] leading-snug opacity-90">{s.note}</p>
            </div>
            {i < steps.length - 1 && <span className="hidden self-center text-fg-muted lg:inline">→</span>}
          </li>
        ))}
      </ol>
      <details><summary className="cursor-pointer text-[10px] font-semibold text-fg-muted">AI·엔진 역할과 검증 한계 보기</summary><ul className="mt-2 grid grid-cols-1 gap-1 text-[10px] text-fg-muted md:grid-cols-2">
        {HONESTY_LIMITS.map((line) => (
          <li key={line}>· {line}</li>
        ))}
      </ul></details>
    </div>
  );
}
