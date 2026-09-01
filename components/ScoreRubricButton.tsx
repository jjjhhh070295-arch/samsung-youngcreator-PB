"use client";

import { useEffect, useState } from "react";
import {
  SURVEY_FACTOR_MAPPING,
  SURVEY_MAX_SCORE,
  SURVEY_QUESTIONS,
} from "@/lib/investmentSurvey";

interface Props {
  label?: string;
  className?: string;
}

export default function ScoreRubricButton({
  label = "요인 점수 기준표 확인",
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
          aria-label="투자성향 설문 점수 기준표"
          onMouseDown={() => setOpen(false)}
        >
          <div
            className="max-h-[86vh] w-full max-w-5xl overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4 border-b border-border bg-surface-2 px-5 py-4">
              <div>
                <p className="text-base font-black text-fg">고객 투자성향 설문 내용 및 점수기준</p>
                <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                  설문조사 결과로 7 RRTTLLU 요인을 산출합니다. 총점 {SURVEY_MAX_SCORE}점, 환산점수 = 원점수 × 100 ÷ {SURVEY_MAX_SCORE}.
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

            <div className="max-h-[72vh] overflow-auto p-5 space-y-5">
              <section className="rounded-xl border border-border bg-surface-2 p-4">
                <h3 className="text-sm font-black text-fg">설문 문항 및 배점</h3>
                <div className="mt-3 space-y-4">
                  {SURVEY_QUESTIONS.map((question) => (
                    <div key={question.id} className="rounded-lg border border-border bg-white p-3">
                      <p className="text-sm font-bold text-fg">
                        {question.number}. {question.title}
                        {question.referenceOnly ? (
                          <span className="ml-2 text-[11px] font-semibold text-[#1428A0]">참고용</span>
                        ) : null}
                      </p>
                      <ul className="mt-2 space-y-1">
                        {question.options.map((option) => (
                          <li key={option.id} className="flex items-start justify-between gap-3 text-xs text-fg-muted">
                            <span>{option.label}</span>
                            {!question.referenceOnly ? (
                              <span className="shrink-0 font-bold text-[#1428A0]">{option.score}점</span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-border bg-surface-2 p-4">
                <h3 className="text-sm font-black text-fg">환산점수 · 최종 투자성향</h3>
                <ul className="mt-2 space-y-1 text-xs text-fg-muted">
                  <li>환산점수 = 원점수 × 100 ÷ {SURVEY_MAX_SCORE}</li>
                  <li>0~20점: 안정형</li>
                  <li>21~40점: 안정추구형</li>
                  <li>41~60점: 위험중립형</li>
                  <li>61~80점: 적극투자형</li>
                  <li>81~100점: 공격투자형</li>
                </ul>
                <div className="mt-3 rounded-lg border border-[#1428A0]/20 bg-[#1428A0]/5 p-3 text-xs text-fg-muted">
                  <p className="font-bold text-fg">적합성 제한</p>
                  <p className="mt-1">원금 보전 응답 → 최종 투자성향 안정형으로 제한</p>
                  <p>최소 손실 응답 → 최종 투자성향 위험중립형 이하로 제한</p>
                </div>
              </section>

              <section className="rounded-xl border border-border bg-surface-2 p-4">
                <h3 className="text-sm font-black text-fg">7 RRTTLLU 요인 매핑</h3>
                <div className="mt-3 overflow-hidden rounded-lg border border-border bg-white">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="bg-surface-2 text-fg">
                      <tr>
                        <th className="px-3 py-2 font-bold">요인</th>
                        <th className="px-3 py-2 font-bold">주요 근거</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border text-fg-muted">
                      {SURVEY_FACTOR_MAPPING.map((row) => (
                        <tr key={row.factor}>
                          <td className="px-3 py-2 font-semibold text-fg">{row.factor}</td>
                          <td className="px-3 py-2">{row.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
