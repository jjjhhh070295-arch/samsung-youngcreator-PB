"use client";

import { useState } from "react";
import type { Client } from "@/lib/types";
import type { EvidenceBundle } from "@/lib/advisory/types";
import { ADVISORY_STATUS_LABEL } from "@/lib/advisory/types";
import {
  applyCalcSnapshot,
  approveByPb,
  canIssueClientPdf,
  canLock,
  loadBundle,
  pdfBlockReason,
  saveBundle,
  softLockReasons,
} from "@/lib/advisory/control";
import { JUDGE_MAX_RETRIES } from "@/lib/advisory/constants";

const ORDER: EvidenceBundle["status"][] = ["draft", "review", "locked", "blocked"];

export default function ControlStatusBar({
  bundle,
  client,
  onChange,
}: {
  bundle: EvidenceBundle;
  client: Client;
  onChange: (next: EvidenceBundle) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const pdfOk = canIssueClientPdf(bundle.status);
  const reason = pdfBlockReason(bundle);
  const lockable = canLock(bundle);
  const soft = softLockReasons(bundle);
  const pending = bundle.pendingReasons.length ? bundle.pendingReasons : soft;
  const needsEvidence = soft.some((r) => r.includes("Evidence") || r.includes("Judge") || r.includes("인용") || r.includes("스냅샷"));

  const persist = (next: EvidenceBundle) => {
    saveBundle(next);
    onChange(next);
  };

  /** Evidence가 없으면 먼저 생성한 뒤 PB 승인 → locked 시도 */
  const approve = async () => {
    setBusy(true);
    setActionError("");
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
      persist(next);
      if (next.status !== "locked" && next.status !== "blocked") {
        setActionError(
          next.pendingReasons[0] ||
            softLockReasons(next)[0] ||
            "아직 locked 조건을 충족하지 못했습니다. 아래 안내를 확인하세요.",
        );
      }
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : "승인 처리 실패");
    } finally {
      setBusy(false);
    }
  };

  const ctaLabel = (() => {
    if (busy) return "처리 중…";
    if (bundle.status === "locked") return "승인 완료 (locked)";
    if (bundle.status === "blocked") return "차단됨 — 사유 확인";
    if (lockable) return "PB 검토 완료/승인 → locked 확정";
    if (needsEvidence) return "Evidence 생성 후 locked 확정";
    return "PB 검토 완료/승인";
  })();

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-fg-muted">리포트 상태 (표시용)</span>
        {ORDER.map((s) => (
          <span
            key={s}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              bundle.status === s
                ? s === "blocked"
                  ? "bg-red-600 text-white"
                  : s === "review"
                    ? "bg-[#0B5CAB] text-white"
                    : "bg-[#1428A0] text-white"
                : "bg-surface-2 text-fg-muted opacity-50"
            }`}
            title={
              s === "locked" && bundle.status !== "locked"
                ? "이 칩은 버튼이 아닙니다. 아래 금색 CTA로 확정하세요."
                : ADVISORY_STATUS_LABEL[s]
            }
          >
            {s} · {ADVISORY_STATUS_LABEL[s]}
          </span>
        ))}
      </div>

      <div className="rounded-lg border-2 border-[#1428A0] bg-[#1428A0]/5 p-3">
        <p className="text-xs font-bold text-[#1428A0]">PB 승인 → locked 확정</p>
        <p className="mt-1 text-[11px] text-fg-muted">
          {bundle.status === "locked"
            ? "승인 완료. 고객용 최종 PDF를 발행할 수 있습니다."
            : lockable
              ? "Judge·인용 조건이 충족되었습니다. 아래 버튼을 누르면 locked로 확정됩니다."
              : needsEvidence
                ? "아직 Evidence Bundle(Judge·인용)이 없습니다. 버튼을 누르면 자동 생성 후 locked를 시도합니다."
                : "조건이 부족하면 locked로 가지 않고, 필요한 조치를 아래에 표시합니다."}
        </p>
        <p className="mt-1 text-[10px] font-semibold text-amber-800">
          ※ 위의 grey “locked · 확정” 칩은 버튼이 아닙니다. 반드시 아래 금색 버튼을 누르세요.
        </p>
        <button
          type="button"
          className="mt-3 rounded-lg bg-[#C5A572] px-5 py-3 text-sm font-bold text-[#1a1408] shadow-md hover:bg-[#b8955f] disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy || bundle.status === "locked" || bundle.status === "blocked"}
          onClick={() => void approve()}
        >
          {ctaLabel}
        </button>
        {actionError && <p className="mt-2 text-xs text-red-600">{actionError}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className={`font-semibold ${pdfOk ? "text-[#1428A0]" : "text-red-600"}`}>
          {pdfOk ? "locked — 고객용 최종 PDF 발행 가능 (참고용)" : reason}
        </span>
        <span className="text-fg-muted">
          Judge 재시도 {bundle.judgeAttempts}/{JUDGE_MAX_RETRIES}
        </span>
        <span className="font-mono text-[10px] text-fg-muted">status={bundle.status}</span>
      </div>

      {bundle.status !== "locked" && pending.length > 0 && (
        <div className="rounded-lg border border-[#0B5CAB]/40 bg-[#0B5CAB]/5 px-3 py-2">
          <p className="text-xs font-semibold text-[#0B5CAB]">검토/준비 필요 (무엇을 해야 하는지)</p>
          <ul className="mt-1 space-y-1 text-[11px] text-fg">
            {pending.map((r) => (
              <li key={r}>· {r}</li>
            ))}
          </ul>
        </div>
      )}

      {bundle.blockReasons.length > 0 && (
        <ul className="text-[11px] text-red-600">
          {bundle.blockReasons.slice(0, 4).map((r) => (
            <li key={r}>· {r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
