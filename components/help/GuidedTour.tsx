"use client";

import { TOUR_STEPS } from "@/lib/help/manualContent";

export default function GuidedTour({
  open,
  step,
  onPrev,
  onNext,
  onClose,
}: {
  open: boolean;
  step: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  if (!open) return null;
  const s = TOUR_STEPS[Math.min(step, TOUR_STEPS.length - 1)]!;
  return (
    <div className="fixed bottom-4 left-1/2 z-50 w-[min(92vw,420px)] -translate-x-1/2 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-white shadow-xl" role="dialog" aria-label="처음 안내">
      <p className="text-[10px] uppercase tracking-wide text-emerald-400">
        안내 {step + 1}/{TOUR_STEPS.length}
      </p>
      <h3 className="mt-1 text-sm font-bold">{s.title}</h3>
      <p className="mt-2 text-xs text-slate-300">{s.body}</p>
      <div className="mt-3 flex justify-between gap-2">
        <button type="button" className="rounded border border-slate-600 px-2 py-1 text-xs" onClick={onClose}>
          그만 보기
        </button>
        <div className="flex gap-2">
          <button type="button" className="rounded border border-slate-600 px-2 py-1 text-xs" onClick={onPrev} disabled={step === 0}>
            이전
          </button>
          <button type="button" className="rounded bg-white px-2 py-1 text-xs font-bold text-slate-900" onClick={onNext}>
            {step >= TOUR_STEPS.length - 1 ? "완료" : "다음"}
          </button>
        </div>
      </div>
    </div>
  );
}
