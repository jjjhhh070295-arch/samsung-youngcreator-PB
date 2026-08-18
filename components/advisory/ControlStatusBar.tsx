"use client";

import type { AdvisoryStatus, EvidenceBundle } from "@/lib/advisory/types";
import { ADVISORY_STATUS_LABEL } from "@/lib/advisory/types";
import { canIssueClientPdf, canTransition, transitionStatus } from "@/lib/advisory/control";

const ORDER: AdvisoryStatus[] = ["draft", "review", "locked", "blocked"];

export default function ControlStatusBar({
  bundle,
  onChange,
}: {
  bundle: EvidenceBundle;
  onChange: (next: EvidenceBundle) => void;
}) {
  const pdfOk = canIssueClientPdf(bundle.status);
  return (
    <div className="card flex flex-wrap items-center gap-2 p-3">
      <span className="text-xs font-semibold text-fg-muted">통제 상태</span>
      {ORDER.map((s) => (
        <button
          key={s}
          disabled={s !== bundle.status && !canTransition(bundle.status, s)}
          onClick={() => {
            if (s === bundle.status) return;
            onChange(transitionStatus(bundle, s, "PB", `${ADVISORY_STATUS_LABEL[s]}로 변경`));
          }}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            bundle.status === s
              ? s === "blocked"
                ? "bg-red-600 text-white"
                : "bg-[#1428A0] text-white"
              : "bg-surface-2 text-fg-muted disabled:opacity-40"
          }`}
        >
          {ADVISORY_STATUS_LABEL[s]}
        </button>
      ))}
      <span className={`ml-auto text-xs font-semibold ${pdfOk ? "text-[#1428A0]" : "text-red-600"}`}>
        {pdfOk ? "고객용 PDF 발행 가능 (참고용)" : "blocked — 고객용 PDF 발행 불가"}
      </span>
    </div>
  );
}
