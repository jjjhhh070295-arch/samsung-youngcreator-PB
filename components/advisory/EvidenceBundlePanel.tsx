"use client";

import { useState } from "react";
import type { Client } from "@/lib/types";
import { ADVISORY_STATUS_LABEL, type EvidenceBundle, type EvidenceRun } from "@/lib/advisory/types";
import type { AdvisoryInputContext } from "@/lib/advisory/integrity";
import { applyCalcSnapshot, loadBundle, saveBundle } from "@/lib/advisory/control";
import { sampleBlockedBundle, sampleSuccessBundle } from "@/lib/advisory/sampleRuns";

function runKindLabel(kind: EvidenceRun["kind"]) {
  switch (kind) {
    case "book":
      return "고객북";
    case "ticker":
      return "티커 분석";
    case "recommend":
      return "상품 추천";
    case "pdf":
      return "PDF 확인";
    case "status":
      return "상태 변경";
    case "explain":
      return "설명 생성";
    case "snapshot":
      return "계산 결과";
    case "judge":
      return "검토";
    default:
      return "기록";
  }
}

export default function EvidenceBundlePanel({
  bundle,
  client,
  inputContext,
  onChange,
}: {
  bundle: EvidenceBundle;
  client?: Client;
  inputContext?: AdvisoryInputContext | null;
  onChange?: (next: EvidenceBundle) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sample, setSample] = useState<"live" | "success" | "blocked">("live");

  const shown =
    sample === "success" ? sampleSuccessBundle() : sample === "blocked" ? sampleBlockedBundle() : bundle;
  const finalEvidence = bundle.status === "locked" || bundle.status === "blocked";

  const generate = async () => {
    if (!client) {
      setError("고객 데이터가 없어 계산·검토 기록을 만들 수 없습니다.");
      return;
    }
    if (!inputContext?.assignedPbDisplay) {
      setError("담당 PB 표시 정보를 확인 중입니다. 잠시 후 다시 시도하세요.");
      return;
    }
    if (finalEvidence) {
      setError("확정·차단 기록은 변경할 수 없습니다. 새 검토본 생성 절차가 필요합니다.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/advisory/evidence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client, inputContext }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "생성 실패");
      const merged = applyCalcSnapshot(loadBundle(client.id), data.snap);
      saveBundle(merged);
      onChange?.(merged);
      setSample("live");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "생성 실패");
    } finally {
      setBusy(false);
    }
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(shown, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${shown.runId || shown.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-fg">계산·검토 기록</h3>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary text-xs"
            onClick={generate}
            disabled={busy || !client || finalEvidence}
            title={finalEvidence ? "확정·차단본은 불변입니다. 새 검토본 생성 절차가 필요합니다." : undefined}
          >
            {busy ? "생성 중…" : finalEvidence ? "확정·차단본 변경 불가" : "계산·검토 기록 생성"}
          </button>
          <button type="button" className="btn-outline text-xs" onClick={download}>
            JSON 저장
          </button>
        </div>
      </div>
      <p className="text-[11px] text-fg-muted">
        스크린샷이 아니라 한 번의 실행 기록입니다. 상담 원문, IPS, 설정, 계산 결과, 출처, PB 상담 검토 승인, 차단 기록을 남깁니다.
      </p>
      {finalEvidence && (
        <p className="mt-2 rounded-lg border border-[#DCE4F5] bg-[#F0F3FA] p-2 text-[11px] font-semibold text-[#1428A0]">
          확정·차단 기록은 불변입니다. 입력이나 근거가 바뀌면 새 검토본으로 시작해 다시 PB 상담 검토 승인을 받아야 합니다.
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
        {(["live", "success", "blocked"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setSample(k)}
            className={`rounded-full px-3 py-1 font-semibold ${sample === k ? "bg-[#1428A0] text-white" : "bg-surface-2 text-fg-muted"}`}
          >
            {k === "live" ? "현재 기록" : k === "success" ? "성공 샘플" : "차단 샘플"}
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <dl className="mt-3 grid grid-cols-1 gap-2 text-[11px] md:grid-cols-2">
        <div>검토 기록 ID: <span className="font-mono break-all">{shown.runId}</span></div>
        <div>실행 시간: {shown.updatedAt.slice(0, 19)}</div>
        <div>상태: {ADVISORY_STATUS_LABEL[shown.status]}</div>
        <div>검토 시도: {shown.judgeAttempts}</div>
        <div className="md:col-span-2">입력 확인값: <span className="font-mono break-all">{shown.inputHash || "—"}</span></div>
        <div className="md:col-span-2">설정 확인값: <span className="font-mono break-all">{shown.settingsHash || "—"}</span></div>
        <div className="md:col-span-2">계산 확인값: <span className="font-mono break-all">{shown.resultHash || shown.outputHash || "—"}</span></div>
      </dl>
      <div className="mt-3 rounded-lg bg-surface-2 p-2 text-[11px] text-fg">
        <p className="font-semibold">상담 입력 원문</p>
        <p className="mt-1 whitespace-pre-wrap text-fg-muted">{shown.consultationInput || "—"}</p>
      </div>
      {shown.citation && (
        <p className={`mt-2 text-xs ${shown.citation.passed ? "text-[#1428A0]" : "text-red-600"}`}>
          인용 검증: {shown.citation.message}
        </p>
      )}
      {shown.conflict && (
        <p className={`mt-1 text-xs ${shown.conflict.passed ? "text-[#1428A0]" : "text-amber-700"}`}>
          충돌 감사: {shown.conflict.message}
        </p>
      )}
      {shown.judge && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-fg">
            검토 {shown.judge.passed ? "통과" : "실패"} · {shown.judge.at.slice(0, 19)}
          </p>
          <ul className="mt-1 space-y-1">
            {shown.judge.findings.map((f) => (
              <li key={f.code} className="text-[11px]">
                <span className={f.severity === "fail" ? "text-red-600" : f.severity === "warn" ? "text-amber-700" : "text-[#1428A0]"}>
                  [{f.severity}] {f.code}
                </span>{" "}
                {f.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {shown.citations.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-fg">출처 정보</p>
          <ul className="mt-1 space-y-1 text-[11px] text-fg-muted">
            {shown.citations.map((c) => (
              <li key={`${c.sourceId}-${c.chunkId}`}>
                {c.sourceId} · {c.title} · as-of {c.asOf}
              </li>
            ))}
          </ul>
        </div>
      )}
      {shown.calcResults && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-3">
          <p>기대수익 {shown.calcResults.risk.expectedReturn.value}%</p>
          <p>변동성 {shown.calcResults.risk.volatility.value}%</p>
          <p>Sharpe {shown.calcResults.risk.sharpe.value}</p>
          <p>MDD {shown.calcResults.risk.mdd.value}%</p>
          <p>VaR95 {shown.calcResults.risk.var95.value}%</p>
          <p>CVaR95 {shown.calcResults.risk.cvar95.value}%</p>
        </div>
      )}
      <div className="mt-3">
        <p className="text-xs font-semibold text-fg">실행 기록</p>
        <ul className="mt-1 max-h-40 space-y-1 overflow-auto">
          {shown.runs.length === 0 && <li className="text-[11px] text-fg-muted">아직 실행 기록이 없습니다.</li>}
          {shown.runs.map((r) => (
            <li key={r.id} className="text-[11px] text-fg-muted">
              {r.at.slice(0, 19)} · {runKindLabel(r.kind)} · {r.notes}
              {r.judge ? ` · 검토 ${r.judge.passed ? "통과" : "차단"}` : ""}
              {r.citations?.length ? ` · 출처 ${r.citations.length}건` : ""}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-3">
        <p className="text-xs font-semibold text-fg">PB 상담 검토 승인 이력</p>
        <ul className="mt-1 space-y-1">
          {shown.approvals.length === 0 && <li className="text-[11px] text-fg-muted">승인 이력 없음</li>}
          {shown.approvals.map((a, i) => (
            <li key={`${a.at}-${i}`} className="text-[11px] text-fg-muted">
              {a.at.slice(0, 19)} · {a.actor} · {a.from} → {a.to} · {a.note}
            </li>
          ))}
        </ul>
      </div>
      {shown.blockReasons.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-red-600">차단 기록</p>
          <ul className="mt-1 text-[11px] text-red-600">
            {shown.blockReasons.map((r) => (
              <li key={r}>· {r}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
