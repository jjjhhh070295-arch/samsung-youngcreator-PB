"use client";

import { useEffect, useState } from "react";
import {
  catalogLabel,
  INDICATOR_CATALOG,
  MAX_INDICATOR_SLOTS,
  type IndicatorKind,
  type IndicatorSlot,
  type TickerIndicatorPrefs,
} from "@/lib/advisory/tickerIndicatorConfig";
import { createSlot } from "@/lib/advisory/tickerPrefsStorage";

export function TickerIndicatorSettingsDrawer({
  open,
  onClose,
  prefs,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  prefs: TickerIndicatorPrefs;
  onSave: (next: TickerIndicatorPrefs) => void;
}) {
  const [draft, setDraft] = useState(prefs);

  useEffect(() => {
    if (open) setDraft(prefs);
  }, [open, prefs]);

  if (!open) return null;

  const updateSlot = (id: string, patch: Partial<IndicatorSlot>) => {
    setDraft((d) => ({
      ...d,
      slots: d.slots.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  };

  const addSlot = (kind: IndicatorKind) => {
    if (draft.slots.length >= MAX_INDICATOR_SLOTS) return;
    setDraft((d) => ({
      ...d,
      slots: [...d.slots, createSlot(kind, catalogLabel(kind))],
    }));
  };

  const removeSlot = (id: string) => {
    setDraft((d) => ({ ...d, slots: d.slots.filter((s) => s.id !== id) }));
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-3">
          <p className="text-xs font-semibold tracking-widest text-[#1428A0]">지표 설정</p>
          <h2 className="text-lg font-bold text-fg">분석 지표 커스터마이징</h2>
          <p className="mt-1 text-xs text-fg-muted">
            최대 {MAX_INDICATOR_SLOTS}개 · 이름 변경 가능 · 브라우저에 저장
          </p>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {draft.slots.map((slot, idx) => (
            <div key={slot.id} className="rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] font-semibold text-fg-muted">슬롯 {idx + 1}</span>
                <button
                  type="button"
                  className="text-[10px] text-red-600"
                  onClick={() => removeSlot(slot.id)}
                >
                  삭제
                </button>
              </div>
              <label className="mt-2 block text-[10px] text-fg-muted">표시 이름</label>
              <input
                className="input mt-1 w-full text-sm"
                value={slot.displayName}
                onChange={(e) => updateSlot(slot.id, { displayName: e.target.value })}
              />
              <label className="mt-2 block text-[10px] text-fg-muted">지표 종류</label>
              <select
                className="input mt-1 w-full text-sm"
                value={slot.kind}
                onChange={(e) =>
                  updateSlot(slot.id, { kind: e.target.value as IndicatorKind })
                }
              >
                {INDICATOR_CATALOG.map((opt) => (
                  <option key={opt.kind} value={opt.kind}>
                    {opt.label} — {opt.description}
                  </option>
                ))}
              </select>
            </div>
          ))}

          {draft.slots.length < MAX_INDICATOR_SLOTS && (
            <div className="rounded-xl border border-dashed border-border p-3">
              <p className="text-xs font-semibold text-fg">지표 추가</p>
              <div className="mt-2 flex flex-wrap gap-1">
                {INDICATOR_CATALOG.map((opt) => (
                  <button
                    key={opt.kind}
                    type="button"
                    className="rounded-md border border-border px-2 py-1 text-[10px] hover:border-[#1428A0]"
                    onClick={() => addSlot(opt.kind)}
                  >
                    + {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex gap-2 border-t border-border p-4">
          <button type="button" className="btn-outline flex-1" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="btn-primary flex-1"
            onClick={() => {
              onSave({ ...draft, updatedAt: new Date().toISOString() });
              onClose();
            }}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}
