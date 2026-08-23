"use client";

import { useRef, useState } from "react";
import type { Client } from "@/lib/types";
import type { EvidenceBundle } from "@/lib/advisory/types";
import type { AdvisoryInputContext } from "@/lib/advisory/integrity";
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
  startNewReviewVersion,
} from "@/lib/advisory/control";
import { JUDGE_MAX_RETRIES } from "@/lib/advisory/constants";

const ORDER: EvidenceBundle["status"][] = ["draft", "review", "locked", "blocked"];

export default function ControlStatusBar({
  bundle,
  client,
  inputContext,
  onChange,
}: {
  bundle: EvidenceBundle;
  client: Client;
  inputContext: AdvisoryInputContext | null;
  onChange: (next: EvidenceBundle) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const actionInFlight = useRef(false);
  const pdfOk = canIssueClientPdf(bundle);
  const reason = pdfBlockReason(bundle);
  const lockable = canLock(bundle);
  const soft = softLockReasons(bundle);
  const pending = bundle.pendingReasons.length ? bundle.pendingReasons : soft;
  const needsEvidence = soft.some((r) => r.includes("Evidence") || r.includes("Judge") || r.includes("인용") || r.includes("스냅샷"));

  const persist = (next: EvidenceBundle) => {
    saveBundle(next);
    onChange(next);
  };

  /** 첫 행동은 Evidence 생성까지만, 두 번째 명시 행동에서만 PB 승인을 수행한다. */
  const handlePrimaryAction = async () => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(true);
    setActionError("");
    setActionMessage("");
    try {
      let working = loadBundle(client.id);
      const workingSoft = softLockReasons(working);
      const workingNeedsEvidence = workingSoft.some((reason) =>
        reason.includes("Evidence") || reason.includes("Judge") || reason.includes("인용") || reason.includes("스냅샷"),
      );
      if (!canLock(working) && workingNeedsEvidence) {
        if (!inputContext?.assignedPbDisplay) {
          throw new Error("담당 PB 표시 정보를 확인 중입니다. 잠시 후 다시 시도하세요.");
        }
        const res = await fetch("/api/advisory/evidence", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ client, inputContext }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error || "Evidence Bundle 생성 실패");
        const latest = loadBundle(client.id);
        if (latest.status === "locked" || latest.status === "blocked") {
          onChange(latest);
          if (latest.status === "blocked") {
            setActionError("요청 중 고객 제안 차단 상태로 변경되어 최신 차단본을 유지했습니다.");
          } else {
            setActionMessage("요청 중 승인 상태로 변경되어 최신 확정본을 유지했습니다.");
          }
          return;
        }
        working = applyCalcSnapshot(latest, data.snap);
        persist(working);
        if (working.status === "blocked") {
          setActionError(working.blockReasons[0] || "고객 제안 차단: Evidence 검증에 실패했습니다.");
        } else {
          setActionMessage("Evidence가 생성되었습니다. 아래 근거를 검토한 뒤 PB 상담 검토 승인 버튼을 다시 누르세요.");
        }
        return;
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
      actionInFlight.current = false;
      setBusy(false);
    }
  };

  const handleStartNewReview = () => {
    setActionError("");
    setActionMessage("");
    const result = startNewReviewVersion(bundle, "PB");
    if (!result.ok) {
      setActionError(result.error ?? "새 검토본을 만들지 못했습니다.");
      return;
    }
    onChange(result.bundle);
    setActionMessage(
      `새 draft v${result.bundle.version}를 시작했습니다. 이전 ${bundle.status} 원본 ${result.archivedBundleId}은 보존되었습니다.`,
    );
  };

  const ctaLabel = (() => {
    if (busy) return "처리 중…";
    if (bundle.status === "locked") return "PB 상담 검토 승인 완료";
    if (bundle.status === "blocked") return "고객 제안 차단 — 사유 확인";
    if (lockable) return "PB 상담 검토 승인";
    if (needsEvidence) return "Evidence Bundle 생성";
    return "PB 상담 검토 승인";
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
                ? "상태 표시입니다. 아래 PB 상담 검토 승인 버튼으로 확정하세요."
                : ADVISORY_STATUS_LABEL[s]
            }
          >
            {s} · {ADVISORY_STATUS_LABEL[s]}
          </span>
        ))}
      </div>

      <div className="rounded-lg border-2 border-[#1428A0] bg-[#1428A0]/5 p-3">
        <p className="text-xs font-bold text-[#1428A0]">Evidence 생성 → PB 검토 → 명시 승인</p>
        <p className="mt-1 text-[11px] text-fg-muted">
          {bundle.status === "locked"
            ? "상담 검토 승인이 완료되었습니다. 고객용 최종 PDF 발행 조건을 충족했습니다."
            : lockable
              ? "Judge·인용 조건이 충족되었습니다. 아래 승인 버튼을 누르면 내부 상태가 locked로 확정됩니다."
              : needsEvidence
                ? "아직 Evidence Bundle(Judge·인용)이 없습니다. 먼저 생성한 뒤 내용을 검토해야 하며, 생성과 승인은 한 번의 클릭으로 처리되지 않습니다."
                : "조건이 부족하면 locked로 가지 않고, 필요한 조치를 아래에 표시합니다."}
        </p>
        <p className="mt-1 text-[10px] font-semibold text-[#0F1E7A]">
          ※ 위 상태 칩은 진행상태 표시입니다. 버튼 이름이 현재 가능한 행동을 정확히 나타냅니다.
        </p>
        <button
          type="button"
          className="mt-3 rounded-lg bg-[#2C3EE8] px-5 py-3 text-sm font-bold text-white shadow-md hover:bg-[#1A2CC4] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy || bundle.status === "locked" || bundle.status === "blocked"}
          onClick={() => void handlePrimaryAction()}
          aria-busy={busy}
        >
          {ctaLabel}
        </button>
        {(bundle.status === "locked" || bundle.status === "blocked") && (
          <div className="mt-3 rounded-lg border border-[#DCE4F5] bg-white p-3">
            <p className="text-xs font-semibold text-fg">
              현재 {bundle.status} 원본은 수정하지 않습니다.
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
              아래 행동은 현재 원본의 ID·해시·승인·차단 기록을 별도 보존하고, 새 ID의 빈 draft 검토본을 만듭니다.
            </p>
            <button
              type="button"
              className="mt-3 min-h-11 rounded-lg border border-[#2C3EE8] bg-white px-4 py-2 text-sm font-bold text-[#1428A0] hover:bg-[#EEF1FF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8] focus-visible:ring-offset-2"
              onClick={handleStartNewReview}
            >
              새 검토본 시작
            </button>
          </div>
        )}
        {actionMessage && <p className="mt-2 text-xs font-semibold text-[#1428A0]" role="status">{actionMessage}</p>}
        {actionError && <p className="mt-2 text-xs text-red-600" role="alert">{actionError}</p>}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className={`font-semibold ${pdfOk ? "text-[#1428A0]" : "text-red-600"}`}>
          {pdfOk ? "locked — 로컬 게이트 통과 · PDF 화면에서 운영 원본/로컬 자기일치 모드를 구분해 재검증" : reason}
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
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-700">
          <p className="text-xs font-bold">고객 제안 차단 사유</p>
          <ul className="mt-1 text-[11px]">
          {bundle.blockReasons.slice(0, 4).map((r) => (
            <li key={r}>· {r}</li>
          ))}
          </ul>
        </div>
      )}
    </div>
  );
}
