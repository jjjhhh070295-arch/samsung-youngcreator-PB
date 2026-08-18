"use client";

import type { EvidenceBundle } from "@/lib/advisory/types";
import { ADVISORY_STATUS_LABEL } from "@/lib/advisory/types";
import {
  approveByPb,
  canIssueClientPdf,
  canLock,
  canTransition,
  pdfBlockReason,
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

  return (
    <div className="card space-y-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-fg-muted">리포트 상태</span>
        {ORDER.map((s) => (
          <button
            key={s}
            type="button"
            disabled={s !== bundle.status && !(s === "locked" ? lockable && canTransition(bundle.status, s) : canTransition(bundle.status, s))}
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
        <button
          type="button"
          className="btn-gold ml-auto text-xs"
          onClick={() => onChange(approveByPb(bundle, "PB"))}
        >
          PB 승인
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className={`font-semibold ${pdfOk ? "text-[#1428A0]" : "text-red-600"}`}>
          {pdfOk ? "locked — 고객용 최종 PDF 발행 가능 (참고용)" : reason}
        </span>
        <span className="text-fg-muted">
          Judge 재시도 {bundle.judgeAttempts}/{JUDGE_MAX_RETRIES}
        </span>
      </div>
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
