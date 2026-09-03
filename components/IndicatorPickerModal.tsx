"use client";

// 전광판 지표 선택 모달 — 카테고리 아코디언 체크리스트 + 선택 순서 조정.
//
// 정렬을 드래그로 하지 않는 이유: dnd 라이브러리를 새로 들이는 비용(번들·터치 대응)이
// 항목 8개짜리 목록에는 과하다. 선택한 순서를 그대로 배치 순서로 쓰고, 그 안에서
// ▲▼ 로 미세 조정하는 편이 코드도 접근성도 단순하다.
//
// 변경은 즉시 상위로 올려보낸다(onChange) — 모달을 닫았다 열어 확인하는 왕복을 없앤다.

import { useEffect, useMemo, useState } from "react";
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  MARKET_INDICATORS,
  MAX_INDICATORS,
  MIN_INDICATORS,
  getIndicator,
  indicatorsByCategory,
  type IndicatorCategory,
} from "@/lib/marketIndicators";

interface Props {
  open: boolean;
  selected: string[];
  onChange: (ids: string[]) => void;
  onReset: () => void;
  onClose: () => void;
}

const SOURCE_LABEL: Record<string, string> = {
  yahoo: "Yahoo",
  fred: "FRED",
  naver: "네이버",
};

export default function IndicatorPickerModal({ open, selected, onChange, onReset, onClose }: Props) {
  // 처음 열 때는 선택된 지표가 있는 카테고리를 펼쳐 둔다.
  const [openCategories, setOpenCategories] = useState<Set<IndicatorCategory>>(new Set());

  useEffect(() => {
    if (!open) return;
    const withSelection = new Set<IndicatorCategory>();
    for (const id of selected) {
      const ind = getIndicator(id);
      if (ind) withSelection.add(ind.category);
    }
    setOpenCategories(withSelection.size > 0 ? withSelection : new Set<IndicatorCategory>(["domestic"]));
  }, [open, selected]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  if (!open) return null;

  const atMax = selected.length >= MAX_INDICATORS;
  const atMin = selected.length <= MIN_INDICATORS;

  const toggle = (id: string) => {
    if (selectedSet.has(id)) {
      if (atMin) return; // 최소 개수 아래로는 못 뺀다
      onChange(selected.filter((x) => x !== id));
    } else {
      if (atMax) return;
      onChange([...selected, id]); // 선택 순서 = 배치 순서
    }
  };

  const move = (index: number, delta: number) => {
    const next = [...selected];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const toggleCategory = (c: IndicatorCategory) => {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="전광판 지표 선택"
        className="mx-auto my-6 w-full max-w-3xl rounded-2xl border border-border bg-surface p-5 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
          <div>
            <h2 className="text-lg font-black text-fg">전광판 지표 선택</h2>
            <p className="mt-1 text-xs text-fg-muted">
              최소 {MIN_INDICATORS}개, 최대 {MAX_INDICATORS}개. 선택한 순서대로 전광판에 표시됩니다.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" className="btn-outline text-xs" onClick={onReset}>
              기본값으로
            </button>
            <button type="button" className="btn-primary text-sm" onClick={onClose}>
              닫기
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_260px]">
          {/* 좌 — 카테고리 아코디언 */}
          <div className="space-y-2">
            {CATEGORY_ORDER.map((category) => {
              const list = indicatorsByCategory(category);
              const opened = openCategories.has(category);
              const pickedInCategory = list.filter((i) => selectedSet.has(i.id)).length;
              return (
                <div key={category} className="overflow-hidden rounded-xl border border-border">
                  <button
                    type="button"
                    aria-expanded={opened}
                    onClick={() => toggleCategory(category)}
                    className="flex w-full items-center justify-between gap-2 bg-surface-2 px-3 py-2 text-left text-sm font-bold text-fg"
                  >
                    <span>
                      {CATEGORY_LABEL[category]}
                      <span className="ml-1.5 text-[10px] font-normal text-fg-muted">
                        {pickedInCategory > 0 ? `${pickedInCategory}/${list.length} 선택` : `${list.length}개`}
                      </span>
                    </span>
                    <span aria-hidden="true" className="text-[10px] text-fg-muted">{opened ? "▲" : "▼"}</span>
                  </button>
                  {opened && (
                    <ul className="divide-y divide-border">
                      {list.map((ind) => {
                        const checked = selectedSet.has(ind.id);
                        const disabled = (!checked && atMax) || (checked && atMin);
                        return (
                          <li key={ind.id}>
                            <label
                              className={`flex items-center gap-2 px-3 py-2 text-sm ${
                                disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-surface-2"
                              }`}
                              title={
                                disabled
                                  ? checked
                                    ? `최소 ${MIN_INDICATORS}개는 남겨야 합니다`
                                    : `최대 ${MAX_INDICATORS}개까지 선택할 수 있습니다`
                                  : undefined
                              }
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={disabled}
                                onChange={() => toggle(ind.id)}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="font-medium text-fg">{ind.label}</span>
                                <span className="ml-1.5 text-[11px] text-fg-muted">{ind.sub}</span>
                              </span>
                              <span className="shrink-0 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] text-fg-muted">
                                {SOURCE_LABEL[ind.source] ?? ind.source}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>

          {/* 우 — 선택 순서 */}
          <div className="rounded-xl border border-border p-3">
            <p className="text-xs font-bold text-fg">
              표시 순서 <span className="font-normal text-fg-muted">{selected.length}/{MAX_INDICATORS}</span>
            </p>
            {selected.length === 0 ? (
              <p className="mt-2 text-[11px] text-fg-muted">선택된 지표가 없습니다.</p>
            ) : (
              <ol className="mt-2 space-y-1">
                {selected.map((id, index) => {
                  const ind = getIndicator(id);
                  if (!ind) return null;
                  return (
                    <li key={id} className="flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1.5">
                      <span className="w-4 shrink-0 text-[10px] text-fg-muted">{index + 1}</span>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium text-fg">{ind.label}</span>
                      <button
                        type="button"
                        aria-label={`${ind.label} 위로`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                        className="shrink-0 rounded px-1 text-[11px] text-fg-muted hover:bg-white disabled:opacity-30"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        aria-label={`${ind.label} 아래로`}
                        disabled={index === selected.length - 1}
                        onClick={() => move(index, 1)}
                        className="shrink-0 rounded px-1 text-[11px] text-fg-muted hover:bg-white disabled:opacity-30"
                      >
                        ▼
                      </button>
                    </li>
                  );
                })}
              </ol>
            )}
            <p className="mt-3 text-[10px] leading-relaxed text-fg-muted">
              FRED 지표는 미 연준 세인트루이스 연은 데이터입니다. API 키가 없는 환경에서는
              동봉 스냅샷으로 표시되며, 값 옆에 기준일이 함께 나옵니다.
            </p>
            <p className="mt-2 text-[10px] text-fg-muted">
              전체 {MARKET_INDICATORS.length}개 지표 중 선택합니다.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
