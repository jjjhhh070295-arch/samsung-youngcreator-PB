"use client";

// 값을 확정 반영하기 전 확인 화면 — 두 출처에서 재사용한다.
//   1) 설문 제출 후 반영 (mergeSurveyIps, mode="survey")
//   2) 상담 중 AI 분석 후 반영 (mergeConsultationAiIps, mode="consultation")
//
// 예전에는 제출/분석 즉시 updateClient({ ips }) 한 줄로 7요인 전체가 교체됐다. 상담
// 메모에서 뽑은 근거가 말없이 사라지는 게 가장 큰 문제였으므로, 무엇이 무엇으로
// 바뀌는지 · 근거 문장이 사라지는지를 먼저 보여주고 PB가 확인한 뒤에만 저장한다.
//
// 변경이 하나도 없으면 호출부가 이 모달을 띄우지 않고 바로 저장한다(불필요한 클릭 방지).
//
// mode로 문구를 분리하는 이유: 두 출처가 표에 올리는 kind 값의 의미가 다르다
// (예: "replaced"는 설문 모드에선 "설문 추정치로 교체", 상담 모드에선 "AI 분석
// 결과로 교체"). "설문"이라는 단어가 하드코딩돼 있으면 상담 중 분석 확인 화면에
// 그대로 노출돼 PB가 헷갈린다 — 실제로 그런 스크린샷이 나온 적 있다.

import { useEffect } from "react";
import type { SurveyFactorChange, SurveyChangeKind } from "@/lib/surveyIpsMerge";

export type DiffModalMode = "survey" | "consultation";

interface Props {
  open: boolean;
  changes: SurveyFactorChange[];
  saving?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** 기본값 survey — 기존 호출부(설문 확인)는 그대로 동작한다. */
  mode?: DiffModalMode;
}

interface ModeCopy {
  ariaLabel: string;
  title: string;
  description: string;
  evidenceLossNote: string;
  kindLabel: Record<SurveyChangeKind, string>;
}

const MODE_COPY: Record<DiffModalMode, ModeCopy> = {
  survey: {
    ariaLabel: "설문 반영 내용 확인",
    title: "설문 반영 내용 확인",
    description:
      "목표수익률·위험허용도·투자기간은 설문이 정본이라 그대로 반영합니다. 세금·유동성·법적·고유 상황은 상담에서 확정된 근거가 있으면 설문이 덮지 않습니다.",
    evidenceLossNote:
      "상담 메모에서 인용한 근거·추론 단서가 설문 추정치로 대체됩니다. 되돌리려면 상담 분석을 다시 실행해야 합니다.",
    kindLabel: {
      survey: "설문 반영",
      preserved: "상담 근거 유지",
      filled: "신규 입력",
      replaced: "설문 추정치로 교체",
      unchanged: "변화 없음",
    },
  },
  consultation: {
    ariaLabel: "상담 분석 반영 내용 확인",
    title: "상담 분석 반영 내용 확인",
    description:
      "AI가 상담 원문에서 뽑은 값입니다. 원문에 근거가 없는 요인은 채우지 않았습니다. 이미 확정된 값을 덮어쓰는 요인만 확인이 필요합니다.",
    evidenceLossNote:
      "기존 근거·추론 단서가 새 AI 분석 결과로 대체됩니다. 되돌리려면 분석을 다시 실행해야 합니다.",
    kindLabel: {
      survey: "AI 분석 반영",
      preserved: "기존 근거 유지",
      filled: "신규 입력",
      replaced: "AI 분석 결과로 교체",
      unchanged: "변화 없음",
    },
  },
};

const KIND_CLASS: Record<SurveyChangeKind, string> = {
  survey: "bg-[#1428A0]/10 text-[#1428A0]",
  preserved: "bg-emerald-50 text-emerald-700",
  filled: "bg-surface-2 text-fg-muted",
  replaced: "bg-amber-50 text-amber-700",
  unchanged: "bg-surface-2 text-fg-muted",
};

const showScore = (s: number | null) => (s == null ? "—" : String(s));
const showValue = (v: string) => (v ? v : "(비어 있음)");

export default function SurveyApplyDiffModal({ open, changes, saving, onConfirm, onCancel, mode = "survey" }: Props) {
  const copy = MODE_COPY[mode];
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const evidenceLoss = changes.filter((c) => c.losesEvidence);
  const preserved = changes.filter((c) => c.kind === "preserved");

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={copy.ariaLabel}
      onMouseDown={onCancel}
    >
      <div
        className="mx-auto my-6 w-full max-w-3xl rounded-2xl border border-border bg-surface p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border pb-3">
          <h2 className="text-lg font-black text-fg">{copy.title}</h2>
          <p className="mt-1 text-xs text-fg-muted">{copy.description}</p>
        </div>

        {evidenceLoss.length > 0 && (
          <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900">
            <p className="font-bold">
              근거 문장이 사라지는 요인 {evidenceLoss.length}개 — {evidenceLoss.map((c) => c.label).join(", ")}
            </p>
            <p className="mt-1">{copy.evidenceLossNote}</p>
          </div>
        )}

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="border-b border-border text-fg-muted">
              <tr>
                <th className="py-2 pr-2 font-bold">요인</th>
                <th className="py-2 pr-2 font-bold">처리</th>
                <th className="py-2 pr-2 font-bold">현재</th>
                <th className="py-2 pr-2 font-bold">반영 후</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {changes.map((c) => (
                <tr key={c.key} className={c.kind === "unchanged" ? "opacity-50" : undefined}>
                  <td className="py-2 pr-2 align-top font-bold text-fg">{c.label}</td>
                  <td className="py-2 pr-2 align-top">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${KIND_CLASS[c.kind]}`}>
                      {copy.kindLabel[c.kind]}
                    </span>
                    {c.losesEvidence && (
                      <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
                        근거 소실
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-2 align-top text-fg-muted">
                    <span className="font-mono">{showScore(c.before.score)}</span> · {showValue(c.before.value)}
                    {c.before.evidence && (
                      <span className="mt-0.5 block text-[10px] text-fg-muted/80">근거: {c.before.evidence}</span>
                    )}
                    {!c.before.evidence && c.before.inferenceHint && (
                      <span className="mt-0.5 block text-[10px] text-fg-muted/80">단서: {c.before.inferenceHint}</span>
                    )}
                  </td>
                  <td className="py-2 pr-2 align-top text-fg">
                    <span className="font-mono">{showScore(c.after.score)}</span> · {showValue(c.after.value)}
                    <span className="mt-0.5 block text-[10px] text-fg-muted">
                      {c.after.reviewed ? "검토 확정" : "검토 필요"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {preserved.length > 0 && (
          <p className="mt-3 text-[11px] text-fg-muted">
            상담 근거가 있어 유지한 요인: {preserved.map((c) => c.label).join(", ")}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
          <button type="button" className="btn-outline text-sm" onClick={onCancel} disabled={saving}>
            취소
          </button>
          <button type="button" className="btn-primary text-sm" onClick={onConfirm} disabled={saving} autoFocus>
            {saving ? "반영 중…" : "이대로 반영"}
          </button>
        </div>
      </div>
    </div>
  );
}
