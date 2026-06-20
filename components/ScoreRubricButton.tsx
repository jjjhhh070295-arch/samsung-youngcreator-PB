"use client";

import { useEffect, useState } from "react";
import { FACTOR_META } from "@/lib/types";
import { SCORE_RUBRIC } from "@/lib/scoring";

interface Props {
  label?: string;
  className?: string;
}

export default function ScoreRubricButton({
  label = "AI점수 기준표 확인",
  className = "rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-bold text-fg-muted transition-colors hover:border-gold-400 hover:text-gold-700",
}: Props) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        {label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="7요인 점수 기준표"
          onMouseDown={() => setOpen(false)}
        >
          <div
            className="max-h-[86vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border bg-surface-2 px-5 py-4">
              <div>
                <p className="text-base font-black text-fg">RRTTLLU 7요인 점수 기준표</p>
                <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                  AI 분석과 수동 입력 모두 아래 1~5점 기준을 사용합니다. 점수가 높을수록 해당 요인의 강도나 제약 수준이 큽니다.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border border-border bg-surface px-2.5 py-1 text-xs font-bold text-fg-muted transition-colors hover:text-fg"
              >
                닫기
              </button>
            </div>
            <div className="max-h-[72vh] overflow-auto p-5">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                {FACTOR_META.map((factor) => (
                  <section key={factor.key} className="rounded-xl border border-border bg-surface-2 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded bg-navy-800 text-xs font-black text-gold-300">
                        {factor.letter}
                      </span>
                      <div>
                        <h3 className="text-sm font-black text-fg">{factor.label}</h3>
                        <p className="text-[11px] text-fg-muted">{factor.labelEn}</p>
                      </div>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-border bg-surface">
                      <table className="w-full border-collapse text-left text-xs">
                        <tbody className="divide-y divide-border">
                          {SCORE_RUBRIC[factor.key].map((criterion, index) => (
                            <tr key={`${factor.key}-${index}`}>
                              <td className="w-14 bg-surface-2 px-3 py-2 text-center font-black text-gold-700">
                                {index + 1}점
                              </td>
                              <td className="px-3 py-2 leading-relaxed text-fg-muted">{criterion}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
