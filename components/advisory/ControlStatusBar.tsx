"use client";

import type { EvidenceBundle } from "@/lib/advisory/types";
import { ADVISORY_STATUS_LABEL } from "@/lib/advisory/types";
import {
  approveByPb,
  canIssueClientPdf,
  canLock,
  canTransition,
  pdfBlockReason,
  softLockReasons,
  transitionStatus,
} from "@/lib/advisory/control";
import { JUDGE_MAX_RETRIES } from "@/lib/advisory/constants";

const ORDER: EvidenceBundle["status"][] = ["draft", "review", "locked", "blocked"];

export default function ControlStatusBar({
  bundle,
  onChange,
}: {
  bundle: EvidenceBundle;
  onChange: (next: EvidenceBundle) => void;
}) {
  const pdfOk = canIssueClientPdf(bundle.status);
  const reason = pdfBlockReason(bundle);
  const lockable = canLock(bundle);
  const soft = softLockReasons(bundle);
  const pending = bundle.pendingReasons.length ? bundle.pendingReasons : soft;

  const approve = () => {
    const next = approveByPb(bundle, "PB");
    onChange(next);
  };

  const ctaLabel =
    lockable && bundle.status !== "locked"
      ? "PB 검토 완료/승인 → locked"
      : bundle.status === "locked"
        ? "승인 완료 (locked)"
        : bundle.status === "blocked"
          ? "차단됨 — 사유 확인"
          : "PB 검토 완료/승인";

  return (
    <div className="card space-y-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-fg-muted">리포트 상태</span>
        {ORDER.map((s) => (
          <button
            key={s}
            type="button"
            disabled={
              s !== bundle.status &&
              !(s === "locked" ? lockable && canTransition(bundle.status, s) : canTransition(bundle.status, s))
            }
            onClick={() => {
              if (s === bundle.status) return;
              onChange(transitionStatus(bundle, s, "PB", `${ADVISORY_STATUS_LABEL[s]}로 변경`));
            }}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              bundle.status === s
                ? s === "blocked"
                  ? "bg-red-600 text-white"
                  : s === "review"
                    ? "bg-[#0B5CAB] text-white"
                    : "bg-[#1428A0] text-white"
                : "bg-surface-2 text-fg-muted disabled:opacity-40"
            }`}
          >
            {s} · {ADVISORY_STATUS_LABEL[s]}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-[#1428A0]/30 bg-[#1428A0]/5 p-3">
        <p className="text-xs font-bold text-[#1428A0]">PB 승인 단계</p>
        <p className="mt-1 text-[11px] text-fg-muted">
          {bundle.status === "locked"
            ? "승인 완료. 고객용 최종 PDF를 발행할 수 있습니다."
            : lockable
              ? "Judge·인용 조건이 충족되었습니다. 아래 버튼을 누르면 locked로 확정됩니다."
              : "조건이 부족하면 locked로 가지 않고, 필요한 조치를 아래에 표시합니다."}
        </p>
        <button
          type="button"
          className="btn-gold mt-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          disabled={bundle.status === "locked" || bundle.status === "blocked"}
          onClick={approve}
        >
          {ctaLabel}
        </button>
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
