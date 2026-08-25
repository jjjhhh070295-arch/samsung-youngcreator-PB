"use client";

import { useEffect } from "react";
import { MANUAL_SECTIONS, BUTTON_HELP, nextActionLabel, type NextAction } from "@/lib/help/manualContent";

export default function TradingManual({
  open,
  onClose,
  nextAction,
}: {
  open: boolean;
  onClose: () => void;
  nextAction: NextAction;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      role="dialog"
      aria-modal="true"
      aria-label="사용 방법"
      onClick={onClose}
    >
      <aside
        className="flex h-full w-full max-w-md flex-col bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="text-base font-bold text-slate-900">사용 방법</h2>
          <button type="button" className="btn-outline" onClick={onClose} aria-label="설명서 닫기">
            닫기
          </button>
        </header>
        <div className="border-b bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="font-semibold">지금 해야 할 일</p>
          <p className="mt-1">{nextActionLabel(nextAction)}</p>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm text-slate-700">
          {MANUAL_SECTIONS.map((s) => (
            <section key={s.id}>
              <h3 className="font-bold text-slate-900">{s.title}</h3>
              {s.paragraphs.map((p) => (
                <p key={p} className="mt-2 leading-relaxed">
                  {p}
                </p>
              ))}
              {s.bullets && (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {s.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          <section>
            <h3 className="font-bold text-slate-900">버튼 설명</h3>
            <ul className="mt-2 space-y-2">
              {Object.entries(BUTTON_HELP).map(([k, v]) => (
                <li key={k} className="rounded bg-slate-50 px-2 py-1 text-xs">
                  <span className="font-semibold">{k}</span> — {v}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </aside>
    </div>
  );
}
