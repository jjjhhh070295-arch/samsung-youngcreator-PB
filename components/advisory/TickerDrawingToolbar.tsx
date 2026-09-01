"use client";

import type { DrawingTool } from "@/lib/advisory/drawingTypes";

const TOOLS: Array<{ id: DrawingTool; label: string; icon: string }> = [
  { id: "select", label: "선택", icon: "↖" },
  { id: "pen", label: "펜", icon: "✎" },
  { id: "trendline", label: "추세선", icon: "／" },
  { id: "parallel_channel", label: "평행채널", icon: "⫽" },
  { id: "fibonacci", label: "피보나치", icon: "φ" },
  { id: "hline", label: "수평선", icon: "—" },
  { id: "vline", label: "수직선", icon: "|" },
  { id: "long", label: "매수", icon: "▲" },
  { id: "short", label: "매도", icon: "▼" },
  { id: "erase", label: "삭제", icon: "⌫" },
];

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
  const base =
    vertical
      ? "flex flex-col gap-1 border-l border-border bg-surface p-1"
      : "flex gap-1 overflow-x-auto border-t border-border bg-surface p-2 md:hidden";

  return (
    <div className={base}>
      {TOOLS.map((t) => (
        <button
          key={t.id}
          type="button"
          title={t.label}
          className={`rounded-md px-2 py-1.5 text-xs font-semibold ${
            tool === t.id
              ? "bg-[#1428A0] text-white"
              : "border border-border text-fg hover:border-[#1428A0]"
          }`}
          onClick={() => onToolChange(t.id)}
        >
          <span className="mr-1">{t.icon}</span>
          {!vertical && <span>{t.label}</span>}
          {vertical && <span className="sr-only">{t.label}</span>}
        </button>
      ))}
      <div className={`${vertical ? "mt-2 space-y-1 border-t border-border pt-2" : "ml-2 flex items-center gap-2"}`}>
        <input
          type="color"
          value={color}
          onChange={(e) => onStyleChange({ color: e.target.value })}
          className="h-7 w-full cursor-pointer rounded border border-border"
          title="색상"
        />
        <input
          type="range"
          min={1}
          max={4}
          value={strokeWidth}
          onChange={(e) => onStyleChange({ strokeWidth: Number(e.target.value) })}
          title="굵기"
        />
        <label className="flex items-center gap-1 text-[10px] text-fg-muted">
          <input
            type="checkbox"
            checked={showLabels}
            onChange={(e) => onStyleChange({ showLabels: e.target.checked })}
          />
          라벨
        </label>
        <button type="button" className="btn-outline w-full text-[10px]" onClick={onClear}>
          초기화
        </button>
      </div>
    </div>
  );
}
