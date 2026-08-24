"use client";

import { useState } from "react";
import { TAX_PAIN_RUBRICS } from "@/lib/taxPainRubric";

export default function TaxPainRubricButton({
  id,
  label = "세금 고충 기준표",
}: {
  id?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const rubrics = id ? [TAX_PAIN_RUBRICS[id]].filter(Boolean) : Object.values(TAX_PAIN_RUBRICS);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-border bg-surface px-2 py-1 text-[10px] font-bold text-fg-muted hover:border-emerald-400 hover:text-emerald-700"
      >
        {label}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4"
          onMouseDown={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-2xl border border-border bg-surface p-5 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex justify-between gap-4">
              <div>
                <h2 className="text-base font-black text-fg">세금 고충 상/중/하 판단 기준표</h2>
                <p className="mt-1 text-xs text-fg-muted">
                  현금흐름 금액, 총자산 대비 비율, 명시 키워드를 점수화한 상담 보조 기준입니다.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-xs font-bold text-fg-muted">
                닫기
              </button>
            </div>
            <div className="space-y-4">
              {rubrics.map((rubric) => (
                <section key={rubric.id} className="rounded-xl border border-border p-3">
                  <h3 className="text-sm font-bold text-fg">{rubric.title}</h3>
                  <p className="mt-1 text-xs text-fg-muted">{rubric.description}</p>
                  <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-[11px] font-semibold text-fg">
                    {rubric.scoreGuide}
                  </p>
                  <div className="mt-3 overflow-hidden rounded-lg border border-border">
                    <table className="w-full text-left text-xs">
                      <tbody className="divide-y divide-border">
                        {rubric.levels.map((level) => (
                          <tr key={level.severity}>
                            <th className="w-16 bg-surface-2 px-3 py-2 text-fg">{level.severity}</th>
                            <td className="px-3 py-2 text-fg-muted">{level.criteria.join(" · ")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
            <p className="mt-4 text-[11px] text-fg-muted">
              상담 보조용 추정 기준이며 세무·회계 확정 판단이 아닙니다. 실제 세액, 신고, 비용처리 여부는 세무 전문가 확인이 필요합니다.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
