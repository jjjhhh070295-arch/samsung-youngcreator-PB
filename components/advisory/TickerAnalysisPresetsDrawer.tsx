"use client";

import { useEffect, useState } from "react";
import {
  ALL_INDICATOR_KINDS,
  INDICATOR_CATALOG,
  MAX_ANALYSIS_PRESETS,
  type AnalysisPreset,
  type IndicatorKind,
  type TickerAnalysisPresets,
} from "@/lib/advisory/tickerAnalysisPresets";

export function TickerAnalysisPresetsDrawer({
  open,
  onClose,
  presetsDoc,
  editingPresetId,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  presetsDoc: TickerAnalysisPresets;
  editingPresetId: string;
  onSave: (next: TickerAnalysisPresets) => void;
}) {
  const [draft, setDraft] = useState(presetsDoc);
  const [activeId, setActiveId] = useState(editingPresetId);

  useEffect(() => {
    if (open) {
      setDraft(presetsDoc);
      setActiveId(editingPresetId);
    }
  }, [open, presetsDoc, editingPresetId]);

  if (!open) return null;

  const active = draft.presets.find((p) => p.id === activeId) ?? draft.presets[0];

  const updatePreset = (id: string, patch: Partial<AnalysisPreset>) => {
    setDraft((d) => ({
      ...d,
      presets: d.presets.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }));
  };

  const toggleIndicator = (kind: IndicatorKind) => {
    if (!active) return;
    updatePreset(active.id, {
      indicators: { ...active.indicators, [kind]: !active.indicators[kind] },
    });
  };

  const checkedCount = active
    ? ALL_INDICATOR_KINDS.filter((k) => active.indicators[k]).length
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-md flex-col bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-3">
          <p className="text-xs font-semibold tracking-widest text-[#1428A0]">사용자 지정 분석</p>
          <h2 className="text-lg font-bold text-fg">분석 프리셋 편집</h2>
          <p className="mt-1 text-xs text-fg-muted">
            최대 {MAX_ANALYSIS_PRESETS}개 · PB별 저장 · 지표 체크리스트
          </p>
        </div>

        <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2">
          {draft.presets.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setActiveId(p.id)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold ${
                p.id === activeId
                  ? "bg-[#1428A0] text-white"
                  : "border border-border bg-surface text-fg"
              }`}
            >
              {p.name}
            </button>
          ))}
        </div>

        {active && (
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            <div>
              <label className="text-[10px] font-semibold text-fg-muted">프리셋 이름</label>
              <input
                className="input mt-1 w-full text-sm"
                value={active.name}
                onChange={(e) => updatePreset(active.id, { name: e.target.value })}
                placeholder="예: 단기 모멘텀"
              />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-fg">표시할 지표</p>
                <span className="text-[10px] text-fg-muted">{checkedCount}개 선택</span>
              </div>
              <div className="mt-2 space-y-1">
                {INDICATOR_CATALOG.map((opt) => (
                  <label
                    key={opt.kind}
                    className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2 hover:border-[#1428A0]/40"
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={active.indicators[opt.kind]}
                      onChange={() => toggleIndicator(opt.kind)}
                    />
                    <span>
                      <span className="text-sm font-medium text-fg">{opt.label}</span>
                      <span className="block text-[10px] text-fg-muted">{opt.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

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
