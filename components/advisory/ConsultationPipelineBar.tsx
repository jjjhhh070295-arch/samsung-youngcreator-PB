"use client";

import { useState } from "react";
import type { Client } from "@/lib/types";
import type { EvidenceBundle, PipelineStep } from "@/lib/advisory/types";
import { AI_ROLE_COPY, ENGINE_ROLE_COPY, HONESTY_LIMITS } from "@/lib/advisory/constants";
import {
  applyCalcSnapshot,
  approveByPb,
  canLock,
  loadBundle,
  saveBundle,
  softLockReasons,
} from "@/lib/advisory/control";
import { currentPipelineStep } from "@/lib/advisory/pipeline";

const TONE: Record<PipelineStep["state"], string> = {
  complete: "border-[#1428A0] bg-[#1428A0] text-white",
  review: "border-[#C5A572] bg-white text-fg ring-2 ring-[#C5A572]/30",
  blocked: "border-red-200 bg-red-50 text-red-800",
  pending: "border-border bg-surface-2 text-fg-muted",
};

const LABEL: Record<PipelineStep["state"], string> = {
  complete: "완료",
  review: "검토필요",
  blocked: "차단",
  pending: "대기",
};

export default function ConsultationPipelineBar({
  steps,
  client,
  bundle,
  onBundleChange,
  currentLabel,
  statusLabel,
}: {
  steps: PipelineStep[];
  client: Client;
  bundle: EvidenceBundle;
  onBundleChange: (next: EvidenceBundle) => void;
  currentLabel?: string;
  statusLabel?: string;
}) {
  const current = currentPipelineStep(steps);
  const completeCount = steps.filter((step) => step.state === "complete").length;
  const approveStep = steps.find((s) => s.id === "approve");
  const needsApprove = approveStep?.state !== "complete" && bundle.status !== "blocked";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const approve = async () => {
    setBusy(true);
    setError("");
    try {
      let working = loadBundle(client.id);
      if (!canLock(working) && softLockReasons(working).length > 0) {
        const res = await fetch("/api/advisory/evidence", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ client }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Evidence Bundle 생성 실패");
        working = applyCalcSnapshot(working, data.snap);
        saveBundle(working);
      }
      const next = approveByPb(working, "PB");
      saveBundle(next);
      onBundleChange(next);
      if (next.status !== "locked" && next.status !== "blocked") {
        setError(next.pendingReasons[0] || softLockReasons(next)[0] || "locked 조건을 아직 충족하지 못했습니다.");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "승인 실패");
    } finally {
      setBusy(false);
    }
  };

  const cta =
    busy
      ? "처리 중…"
      : bundle.status === "locked"
        ? "3단계 완료 (locked)"
        : canLock(bundle)
          ? "여기를 눌러 3단계 완료 (locked 확정)"
          : "여기를 눌러 Evidence 생성 + 3단계 완료";

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="decision-kicker">Human-in-the-loop</p>
          <p className="decision-title mt-1">{client.name} 고객 상담 · {completeCount} / {steps.length} 단계 완료</p>
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
        <div className="rounded-xl border-2 border-[#C5A572] bg-gradient-to-r from-[#FFF8EB] to-[#F5E6C8] p-4 shadow-sm">
          <p className="text-sm font-bold text-[#8B6914]">3단계 PB 승인 — 이 버튼을 누르세요</p>
          <p className="mt-1 text-[11px] text-[#5C4A1F]">
            위 파이프라인 카드나 회색 “locked · 확정” 칩이 아니라, <strong>아래 금색 버튼</strong>이 실제 승인입니다.
          </p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void approve()}
            className="mt-3 w-full rounded-lg bg-[#C5A572] px-6 py-3.5 text-base font-bold text-[#1a1408] shadow-md hover:bg-[#b8955f] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:min-w-[320px]"
          >
            {cta}
          </button>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
        </div>
      )}

      <ol className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-stretch">
        {steps.map((s, i) => (
          <li key={s.id} className="flex min-w-0 flex-1 items-stretch gap-2">
            <div
              className={`w-full rounded-xl border px-3 py-2.5 ${TONE[s.state]} ${
                current?.id === s.id ? "ring-2 ring-offset-1 ring-[#C5A572]" : ""
              }`}
            >
              <p className="text-[10px] font-semibold uppercase tracking-wide opacity-80">
                {i + 1}. {s.state === "blocked" ? "🔒 " : ""}{LABEL[s.state]}
              </p>
              <p className="text-xs font-bold">{s.label}</p>
              <p className="mt-0.5 text-[10px] leading-snug opacity-90">{s.note}</p>
              {s.id === "approve" && needsApprove && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void approve()}
                  className="mt-2 w-full rounded-md bg-[#C5A572] px-2 py-1.5 text-[11px] font-bold text-[#1a1a1a] hover:bg-[#b8955f] disabled:opacity-50"
                >
                  {busy ? "처리 중…" : "승인 → locked"}
                </button>
              )}
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
