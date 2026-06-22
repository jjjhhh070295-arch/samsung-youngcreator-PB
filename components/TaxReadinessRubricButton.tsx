"use client";

import { useEffect, useState } from "react";
import { READINESS_RUBRIC } from "@/lib/taxReadinessScoring";

export default function TaxReadinessRubricButton({
  label = "준비상태 기준표",
  className = "rounded-md border border-border bg-surface px-2 py-1 text-[10px] font-bold text-fg-muted hover:border-gold-400 hover:text-gold-700",
}: {
  label?: string;
  className?: string;
}) {
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
          aria-label="세금 납부 준비상태 기준표"
          onMouseDown={() => setOpen(false)}
        >
          <div
            className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-2xl border border-border bg-surface p-5 shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-black text-fg">세금 납부 준비상태 정량 기준표</h2>
                <p className="mt-1 text-xs leading-relaxed text-fg-muted">
                  현금화 목표일 순서로 세금 이벤트를 누적하고, 현재 현금성자산과 비교해 커버/점검/부족을 판정합니다.
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="text-xs font-bold text-fg-muted">
                닫기
              </button>
            </div>

            <div className="space-y-3">
              {READINESS_RUBRIC.map((item) => (
                <section key={item.status} className="rounded-xl border border-border bg-surface-2 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-fg">{item.label}</h3>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                        item.status === "covered"
                          ? "border-green-200 bg-green-50 text-green-700"
                          : item.status === "watch"
                            ? "border-amber-200 bg-amber-50 text-amber-700"
                            : "border-red-200 bg-red-50 text-red-700"
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                  <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-[11px] font-semibold text-fg">
                    {item.formula}
                  </p>
                  <ul className="mt-2 space-y-1 text-xs leading-relaxed text-fg-muted">
                    {item.criteria.map((criterion) => (
                      <li key={criterion}>• {criterion}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-fg-muted">
              준비상태는 상담 보조용 유동성 점검입니다. 실제 세액, 납부기한, 비용처리, 법인/개인 자금 이동은 세무 전문가 확인이 필요합니다.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
