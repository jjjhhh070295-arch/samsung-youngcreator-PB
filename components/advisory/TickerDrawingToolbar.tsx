"use client";

import type { DrawingTool } from "@/lib/advisory/drawingTypes";

const TOOLS: Array<{ id: DrawingTool; icon: string; label: string; tip: string }> = [
  { id: "select", icon: "↖", label: "선택/이동", tip: "그린 도형을 선택하고 이동합니다" },
  { id: "pen", icon: "✎", label: "펜", tip: "자유 곡선을 그립니다" },
  { id: "trendline", icon: "／", label: "추세선", tip: "두 점을 연결하는 추세선" },
  { id: "parallel_channel", icon: "∥", label: "평행채널", tip: "추세선과 평행한 채널" },
  { id: "fibonacci", icon: "φ", label: "피보나치", tip: "피보나치 되돌림 (0~100%)" },
  { id: "hline", icon: "─", label: "수평선", tip: "가격 기준 수평선" },
  { id: "vline", icon: "│", label: "수직선", tip: "날짜 기준 수직선" },
  { id: "long", icon: "▲", label: "매수 포지션", tip: "진입·목표·손절 (매수)" },
  { id: "short", icon: "▼", label: "매도 포지션", tip: "진입·목표·손절 (매도)" },
  { id: "erase", icon: "⌫", label: "삭제", tip: "선택된 도형 삭제 또는 클릭한 도형 삭제" },
];

function ToolButton({
  active,
  icon,
  label,
  tip,
  onClick,
  compact,
}: {
  active: boolean;
  icon: string;
  label: string;
  tip: string;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      title={tip}
      aria-label={label}
      onClick={onClick}
      className={`group relative flex min-h-[44px] min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-2 text-center transition-colors ${
        active
          ? "border-[#1428A0] bg-[#1428A0] text-white shadow-sm"
          : "border-border bg-surface text-fg hover:border-[#1428A0] hover:bg-[#1428A0]/5"
      } ${compact ? "shrink-0" : "w-full"}`}
    >
      <span className="text-base leading-none">{icon}</span>
      <span className={`leading-tight ${compact ? "text-[10px] font-semibold" : "text-[10px] font-medium"}`}>
        {label}
      </span>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] text-white group-hover:block group-focus:block">
        {tip}
      </span>
    </button>
  );
}

export function TickerDrawingToolbar({
  tool,
  onToolChange,
  color,
  strokeWidth,
  showLabels,
  onStyleChange,
  onClear,
  vertical = true,
}: {
  tool: DrawingTool;
  onToolChange: (t: DrawingTool) => void;
  color: string;
  strokeWidth: number;
  showLabels: boolean;
  onStyleChange: (patch: { color?: string; strokeWidth?: number; showLabels?: boolean }) => void;
  onClear: () => void;
  vertical?: boolean;
}) {
  if (vertical) {
    return (
      <div className="hidden w-[96px] shrink-0 flex-col gap-1.5 border-l border-border bg-surface p-2 md:flex">
        {TOOLS.map((t) => (
          <ToolButton
            key={t.id}
            active={tool === t.id}
            icon={t.icon}
            label={t.label}
            tip={t.tip}
            onClick={() => onToolChange(t.id)}
          />
        ))}
        <div className="mt-1 space-y-2 border-t border-border pt-2">
          <input
            type="color"
            value={color}
            onChange={(e) => onStyleChange({ color: e.target.value })}
            className="h-9 w-full cursor-pointer rounded border border-border"
            title="선 색상"
          />
          <input
            type="range"
            min={1}
            max={4}
            value={strokeWidth}
            onChange={(e) => onStyleChange({ strokeWidth: Number(e.target.value) })}
            title="선 굵기"
            className="w-full"
          />
          <label className="flex items-center gap-1.5 text-[10px] text-fg-muted">
            <input
              type="checkbox"
              checked={showLabels}
              onChange={(e) => onStyleChange({ showLabels: e.target.checked })}
            />
            라벨 표시
          </label>
          <button
            type="button"
            className="w-full rounded-lg border border-border px-2 py-2 text-[11px] font-semibold hover:border-[#1428A0]"
            onClick={onClear}
            title="모든 드로잉 삭제"
          >
            ↺ 초기화
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-surface/95 backdrop-blur md:hidden">
      <div className="flex gap-1.5 overflow-x-auto px-2 py-2">
        {TOOLS.map((t) => (
          <ToolButton
            key={t.id}
            active={tool === t.id}
            icon={t.icon}
            label={t.label}
            tip={t.tip}
            onClick={() => onToolChange(t.id)}
            compact
          />
        ))}
        <button
          type="button"
          className="shrink-0 rounded-lg border border-border px-3 py-2 text-[10px] font-semibold"
          onClick={onClear}
          title="모든 드로잉 삭제"
        >
          ↺ 초기화
        </button>
      </div>
    </div>
  );
}
