"use client";

import {
  PORTFOLIO_STEP_META,
  type PortfolioWorkflowStep,
} from "@/lib/portfolioWorkflowStep";

const STEPS: PortfolioWorkflowStep[] = ["allocation", "instruments", "approval"];

export default function PortfolioWorkflowStepper({
  step,
}: {
  step: PortfolioWorkflowStep;
}) {
  const meta = PORTFOLIO_STEP_META[step];
  return (
    <div className="rounded-xl border border-border bg-white px-4 py-3 shadow-sm" aria-label="포트폴리오 진행 단계">
      <ol className="flex flex-wrap items-center gap-2 text-xs font-bold sm:gap-3">
        {STEPS.map((id, i) => {
          const m = PORTFOLIO_STEP_META[id];
          const active = id === step;
          const done = m.index < meta.index;
          return (
            <li key={id} className="flex items-center gap-2">
              {i > 0 && <span className="text-fg-muted/50" aria-hidden>→</span>}
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
                  active
                    ? "bg-[#1428A0] text-white"
                    : done
                      ? "bg-[#1428A0]/10 text-[#1428A0]"
                      : "bg-surface-2 text-fg-muted"
                }`}
                aria-current={active ? "step" : undefined}
              >
                <span className="tabular-nums opacity-80">0{m.index}</span>
                {m.label}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="mt-2">
        <p className="text-sm font-black text-fg">
          {String(meta.index).padStart(2, "0")} {meta.label}
        </p>
        <p className="mt-0.5 text-[11px] text-fg-muted">{meta.description}</p>
      </div>
    </div>
  );
}
