"use client";

import { useEffect, useState } from "react";
import TradingManual from "./TradingManual";
import GuidedTour from "./GuidedTour";
import { TOUR_STEPS, type NextAction } from "@/lib/help/manualContent";

export default function HelpToolbar({ nextAction }: { nextAction: NextAction }) {
  const [manualOpen, setManualOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      const seen = localStorage.getItem("kis-trader-tour-asked");
      if (!seen) {
        localStorage.setItem("kis-trader-tour-asked", "1");
        // ask softly
        const ok = window.confirm("처음이신가요? 처음부터 안내를 시작할까요?");
        if (ok) setTourOpen(true);
      }
    } catch { /* ignore */ }
  }, []);

  return (
    <>
      <div className="fixed right-3 top-3 z-40 flex gap-2">
        <button type="button" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold shadow" onClick={() => setManualOpen(true)} aria-label="사용 방법 열기">
          사용 방법
        </button>
        <button type="button" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white shadow" onClick={() => { setStep(0); setTourOpen(true); }} aria-label="처음부터 안내받기">
          처음부터 안내받기
        </button>
      </div>
      <TradingManual open={manualOpen} onClose={() => setManualOpen(false)} nextAction={nextAction} />
      <GuidedTour
        open={tourOpen}
        step={step}
        onClose={() => setTourOpen(false)}
        onPrev={() => setStep((s) => Math.max(0, s - 1))}
        onNext={() => {
          if (step >= TOUR_STEPS.length - 1) setTourOpen(false);
          else setStep((s) => s + 1);
        }}
      />
    </>
  );
}
