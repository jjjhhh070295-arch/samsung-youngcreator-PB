"use client";

import type { EvidenceBundle } from "@/lib/advisory/types";

export default function EvidenceBundlePanel({ bundle }: { bundle: EvidenceBundle }) {
  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-bold text-fg">Evidence Bundle</h3>
        <span className="font-mono text-[10px] text-fg-muted">{bundle.id}</span>
      </div>
      <div className="grid grid-cols-1 gap-2 text-[11px] md:grid-cols-2">
        <p>inputHash: <span className="font-mono break-all">{bundle.inputHash || "—"}</span></p>
        <p>outputHash: <span className="font-mono break-all">{bundle.outputHash || "—"}</span></p>
      </div>
      {bundle.judge && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-fg">
            Judge {bundle.judge.passed ? "통과" : "실패"} · {bundle.judge.at.slice(0, 19)}
          </p>
          <ul className="mt-1 space-y-1">
            {bundle.judge.findings.map((f) => (
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
      <div className="mt-3">
        <p className="text-xs font-semibold text-fg">실행 기록</p>
        <ul className="mt-1 max-h-40 space-y-1 overflow-auto">
          {bundle.runs.length === 0 && <li className="text-[11px] text-fg-muted">아직 실행 기록이 없습니다.</li>}
          {bundle.runs.map((r) => (
            <li key={r.id} className="text-[11px] text-fg-muted">
              {r.at.slice(0, 19)} · {r.kind} · {r.engine} · {r.notes}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-3">
        <p className="text-xs font-semibold text-fg">승인 이력</p>
        <ul className="mt-1 space-y-1">
          {bundle.approvals.length === 0 && <li className="text-[11px] text-fg-muted">승인 이력 없음</li>}
          {bundle.approvals.map((a, i) => (
            <li key={`${a.at}-${i}`} className="text-[11px] text-fg-muted">
              {a.at.slice(0, 19)} · {a.actor} · {a.from} → {a.to} · {a.note}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
