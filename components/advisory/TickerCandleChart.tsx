"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EnrichedBar } from "@/lib/advisory/tickerIndicatorsExtended";
import type { IndicatorKind } from "@/lib/advisory/tickerAnalysisPresets";
import {
  defaultLayout,
  pointerToTP,
  priceToY,
  scalesFromBars,
  timeToX,
  type ChartLayout,
} from "@/lib/advisory/chartCoords";
import {
  FIB_LEVELS,
  positionRiskReward,
  type DrawingDocument,
  type DrawingObject,
  type DrawingTool,
  type PointTP,
} from "@/lib/advisory/drawingTypes";
import { TickerDrawingToolbar } from "./TickerDrawingToolbar";

function uid() {
  return `d-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

type ChartScales = ReturnType<typeof scalesFromBars>;

function pointToXY(point: PointTP, scales: ChartScales, layout: ChartLayout) {
  return {
    x: timeToX(point.time, scales, layout),
    y: priceToY(point.price, scales, layout),
  };
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - x1, py - y1);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function timeIndex(time: string, scales: ChartScales) {
  const idx = scales.times.indexOf(time);
  return idx >= 0 ? idx : Math.max(scales.times.length - 1, 0);
}

function shiftTime(time: string, deltaIndex: number, scales: ChartScales) {
  const next = Math.max(0, Math.min(scales.times.length - 1, timeIndex(time, scales) + deltaIndex));
  return scales.times[next] ?? time;
}

function movePoint(point: PointTP, deltaIndex: number, deltaPrice: number, scales: ChartScales): PointTP {
  return {
    time: shiftTime(point.time, deltaIndex, scales),
    price: point.price + deltaPrice,
  };
}

function moveDrawing(obj: DrawingObject, start: PointTP, current: PointTP, scales: ChartScales): DrawingObject {
  const deltaIndex = timeIndex(current.time, scales) - timeIndex(start.time, scales);
  const deltaPrice = current.price - start.price;
  switch (obj.tool) {
    case "pen":
      return { ...obj, points: obj.points.map((point) => movePoint(point, deltaIndex, deltaPrice, scales)) };
    case "trendline":
      return { ...obj, a: movePoint(obj.a, deltaIndex, deltaPrice, scales), b: movePoint(obj.b, deltaIndex, deltaPrice, scales) };
    case "parallel_channel":
      return { ...obj, a: movePoint(obj.a, deltaIndex, deltaPrice, scales), b: movePoint(obj.b, deltaIndex, deltaPrice, scales) };
    case "fibonacci":
      return { ...obj, high: movePoint(obj.high, deltaIndex, deltaPrice, scales), low: movePoint(obj.low, deltaIndex, deltaPrice, scales) };
    case "hline":
      return { ...obj, price: obj.price + deltaPrice };
    case "vline":
      return { ...obj, time: shiftTime(obj.time, deltaIndex, scales) };
    case "long":
    case "short":
      return {
        ...obj,
        entry: obj.entry + deltaPrice,
        target: obj.target + deltaPrice,
        stop: obj.stop + deltaPrice,
        entryTime: shiftTime(obj.entryTime, deltaIndex, scales),
      };
    default:
      return obj;
  }
}

function hitDrawing(obj: DrawingObject, x: number, y: number, scales: ChartScales, layout: ChartLayout) {
  const threshold = Math.max(8, obj.strokeWidth + 6);
  switch (obj.tool) {
    case "pen": {
      for (let i = 1; i < obj.points.length; i++) {
        const a = pointToXY(obj.points[i - 1], scales, layout);
        const b = pointToXY(obj.points[i], scales, layout);
        if (distanceToSegment(x, y, a.x, a.y, b.x, b.y) <= threshold) return true;
      }
      return false;
    }
    case "trendline": {
      const a = pointToXY(obj.a, scales, layout);
      const b = pointToXY(obj.b, scales, layout);
      return distanceToSegment(x, y, a.x, a.y, b.x, b.y) <= threshold;
    }
    case "parallel_channel": {
      const a = pointToXY(obj.a, scales, layout);
      const b = pointToXY(obj.b, scales, layout);
      const offsetY = priceToY(obj.a.price + obj.offsetPrice, scales, layout) - a.y;
      return (
        distanceToSegment(x, y, a.x, a.y, b.x, b.y) <= threshold ||
        distanceToSegment(x, y, a.x, a.y + offsetY, b.x, b.y + offsetY) <= threshold
      );
    }
    case "fibonacci": {
      const high = pointToXY(obj.high, scales, layout);
      const low = pointToXY(obj.low, scales, layout);
      const left = Math.min(high.x, low.x) - threshold;
      const right = Math.max(high.x, low.x) + threshold;
      if (x < left || x > right) return false;
      const top = Math.max(obj.high.price, obj.low.price);
      const bottom = Math.min(obj.high.price, obj.low.price);
      return FIB_LEVELS.some((lv) => {
        const price = bottom + (top - bottom) * (1 - lv);
        return Math.abs(priceToY(price, scales, layout) - y) <= threshold;
      });
    }
    case "hline":
      return Math.abs(priceToY(obj.price, scales, layout) - y) <= threshold;
    case "vline":
      return Math.abs(timeToX(obj.time, scales, layout) - x) <= threshold;
    case "long":
    case "short": {
      const entryX = timeToX(obj.entryTime, scales, layout);
      const ys = [priceToY(obj.entry, scales, layout), priceToY(obj.target, scales, layout), priceToY(obj.stop, scales, layout)];
      const top = Math.min(...ys) - threshold;
      const bottom = Math.max(...ys) + threshold;
      return x >= entryX - 34 && x <= entryX + 64 && y >= top && y <= bottom;
    }
    default:
      return false;
  }
}

function renderDrawing(
  obj: DrawingObject,
  scales: ChartScales,
  layout: ChartLayout,
  selected: boolean,
) {
  const stroke = obj.color;
  const sw = obj.strokeWidth;
  const dash = selected ? "4 3" : undefined;

  switch (obj.tool) {
    case "pen": {
      const pts = obj.points
        .map((p) => `${timeToX(p.time, scales, layout)},${priceToY(p.price, scales, layout)}`)
        .join(" ");
      return <polyline key={obj.id} points={pts} fill="none" stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />;
    }
    case "trendline": {
      const x1 = timeToX(obj.a.time, scales, layout);
      const y1 = priceToY(obj.a.price, scales, layout);
      const x2 = timeToX(obj.b.time, scales, layout);
      const y2 = priceToY(obj.b.price, scales, layout);
      return <line key={obj.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />;
    }
    case "parallel_channel": {
      const x1 = timeToX(obj.a.time, scales, layout);
      const y1 = priceToY(obj.a.price, scales, layout);
      const x2 = timeToX(obj.b.time, scales, layout);
      const y2 = priceToY(obj.b.price, scales, layout);
      const yOff = priceToY(obj.a.price + obj.offsetPrice, scales, layout) - y1;
      return (
        <g key={obj.id}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
          <line x1={x1} y1={y1 + yOff} x2={x2} y2={y2 + yOff} stroke={stroke} strokeWidth={sw} opacity={0.7} strokeDasharray={dash} />
        </g>
      );
    }
    case "fibonacci": {
      const top = Math.max(obj.high.price, obj.low.price);
      const bottom = Math.min(obj.high.price, obj.low.price);
      const x1 = timeToX(obj.low.time, scales, layout);
      const x2 = timeToX(obj.high.time, scales, layout);
      const left = Math.min(x1, x2);
      const right = Math.max(x1, x2);
      return (
        <g key={obj.id}>
          {FIB_LEVELS.map((lv) => {
            const price = bottom + (top - bottom) * (1 - lv);
            const y = priceToY(price, scales, layout);
            return (
              <g key={lv}>
                <line x1={left} y1={y} x2={right} y2={y} stroke={stroke} strokeWidth={1} opacity={0.85} strokeDasharray={dash} />
                {obj.showLabels && (
                  <text x={right + 4} y={y + 3} fontSize={9} fill={stroke}>
                    {(lv * 100).toFixed(1)}%
                  </text>
                )}
              </g>
            );
          })}
        </g>
      );
    }
    case "hline": {
      const y = priceToY(obj.price, scales, layout);
      return (
        <g key={obj.id}>
          <line x1={layout.paddingLeft} y1={y} x2={layout.width - layout.paddingRight} y2={y} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
          {obj.showLabels && (
            <text x={layout.width - layout.paddingRight + 2} y={y + 3} fontSize={9} fill={stroke}>
              {obj.price.toLocaleString("ko-KR")}
            </text>
          )}
        </g>
      );
    }
    case "vline": {
      const x = timeToX(obj.time, scales, layout);
      return (
        <g key={obj.id}>
          <line x1={x} y1={layout.paddingTop} x2={x} y2={layout.height - layout.paddingBottom} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
          {obj.showLabels && (
            <text x={x + 2} y={layout.paddingTop + 10} fontSize={9} fill={stroke}>
              {obj.time.slice(5)}
            </text>
          )}
        </g>
      );
    }
    case "long":
    case "short": {
      const entryY = priceToY(obj.entry, scales, layout);
      const targetY = priceToY(obj.target, scales, layout);
      const stopY = priceToY(obj.stop, scales, layout);
      const x = timeToX(obj.entryTime, scales, layout);
      const rr = positionRiskReward(obj.entry, obj.target, obj.stop);
      const fill = obj.tool === "long" ? "#ef444433" : "#2563eb33";
      return (
        <g key={obj.id}>
          <rect x={x - 20} y={Math.min(entryY, targetY)} width={40} height={Math.abs(targetY - entryY) || 1} fill={fill} />
          <line x1={x - 30} y1={entryY} x2={x + 30} y2={entryY} stroke={stroke} strokeWidth={sw} />
          <line x1={x - 30} y1={targetY} x2={x + 30} y2={targetY} stroke="#16a34a" strokeWidth={1.5} strokeDasharray="3 2" />
          <line x1={x - 30} y1={stopY} x2={x + 30} y2={stopY} stroke="#dc2626" strokeWidth={1.5} strokeDasharray="3 2" />
          {obj.showLabels && rr.ratio != null && (
            <text x={x + 34} y={entryY} fontSize={9} fill={stroke}>
              R:R {rr.ratio.toFixed(2)}
            </text>
          )}
        </g>
      );
    }
    default:
      return null;
  }
}

export function TickerCandleChart({
  bars,
  overlayKinds,
  streakMarkers,
  volumeProfile,
  drawingDoc,
  onDrawingChange,
  currency,
}: {
  bars: EnrichedBar[];
  overlayKinds: IndicatorKind[];
  streakMarkers: Array<{ time: string; kind: "up3" | "down3" }>;
  volumeProfile: Array<{ price: number; volume: number; weightPct: number }>;
  drawingDoc: DrawingDocument;
  onDrawingChange: (doc: DrawingDocument) => void;
  currency: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 720, h: 360 });
  const [tool, setTool] = useState<DrawingTool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ tool: DrawingTool; points: PointTP[] } | null>(null);
  const [drag, setDrag] = useState<{ id: string; start: PointTP; orig: DrawingObject } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: 360 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => defaultLayout(size.w, size.h), [size]);
  const scales = useMemo(() => scalesFromBars(bars), [bars]);
  const candleW = Math.max(2, (layout.width - layout.paddingLeft - layout.paddingRight) / Math.max(bars.length, 1) * 0.6);

  const showSma = overlayKinds.includes("sma");
  const showBb = overlayKinds.includes("bollinger");
  const showVp = overlayKinds.includes("volume_profile");
  const showStreak = overlayKinds.includes("streak");

  const styleBase = drawingDoc.style;

  const commitObject = useCallback(
    (obj: DrawingObject) => {
      onDrawingChange({
        ...drawingDoc,
        objects: [...drawingDoc.objects, obj],
        updatedAt: new Date().toISOString(),
      });
    },
    [drawingDoc, onDrawingChange],
  );

  const handlePointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const tp = pointerToTP(e.clientX, e.clientY, rect, scales, layout);

    if (tool === "erase") {
      if (e.type !== "pointerdown") return;
      const hit = [...drawingDoc.objects].reverse().find((obj) => hitDrawing(obj, tp.x, tp.y, scales, layout));
      if (!hit) return;
      onDrawingChange({
        ...drawingDoc,
        objects: drawingDoc.objects.filter((obj) => obj.id !== hit.id),
        updatedAt: new Date().toISOString(),
      });
      if (selectedId === hit.id) setSelectedId(null);
      return;
    }

    if (tool === "select") {
      if (e.type === "pointerdown") {
        const hit = [...drawingDoc.objects].reverse().find((obj) => hitDrawing(obj, tp.x, tp.y, scales, layout));
        setSelectedId(hit?.id ?? null);
        if (!hit) {
          setDrag(null);
          return;
        }
        setDrag({ id: hit.id, start: { time: tp.time, price: tp.price }, orig: hit });
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      if (e.type === "pointermove" && drag) {
        onDrawingChange({
          ...drawingDoc,
          objects: drawingDoc.objects.map((obj) => (obj.id === drag.id ? moveDrawing(drag.orig, drag.start, tp, scales) : obj)),
          updatedAt: new Date().toISOString(),
        });
        return;
      }
      if (e.type === "pointerup") {
        setDrag(null);
      }
      return;
    }

    if (e.type === "pointerdown") {
      if (tool === "pen") {
        setDraft({ tool, points: [{ time: tp.time, price: tp.price }] });
      } else if (tool === "hline") {
        commitObject({
          id: uid(),
          tool: "hline",
          price: tp.price,
          color: styleBase.color,
          strokeWidth: styleBase.strokeWidth,
          showLabels: styleBase.showLabels,
        });
      } else if (tool === "vline") {
        commitObject({
          id: uid(),
          tool: "vline",
          time: tp.time,
          color: styleBase.color,
          strokeWidth: styleBase.strokeWidth,
          showLabels: styleBase.showLabels,
        });
      } else {
        setDraft({ tool, points: [{ time: tp.time, price: tp.price }] });
      }
    }

    if (e.type === "pointermove" && draft?.tool === "pen") {
      setDraft({ tool: "pen", points: [...draft.points, { time: tp.time, price: tp.price }] });
    }

    if (e.type === "pointerup" && draft && draft.tool !== "pen") {
      const [a, b] = draft.points.length >= 2 ? draft.points : [draft.points[0], { time: tp.time, price: tp.price }];
      if (draft.tool === "trendline") {
        commitObject({ id: uid(), tool: "trendline", a, b, ...styleBase });
      } else if (draft.tool === "parallel_channel") {
        commitObject({
          id: uid(),
          tool: "parallel_channel",
          a,
          b,
          offsetPrice: (b.price - a.price) * 0.35,
          ...styleBase,
        });
      } else if (draft.tool === "fibonacci") {
        commitObject({ id: uid(), tool: "fibonacci", high: a.price > b.price ? a : b, low: a.price > b.price ? b : a, ...styleBase });
      } else if (draft.tool === "long" || draft.tool === "short") {
        const entry = a.price;
        const target = draft.tool === "long" ? b.price * 1.03 : b.price * 0.97;
        const stop = draft.tool === "long" ? b.price * 0.98 : b.price * 1.02;
        commitObject({
          id: uid(),
          tool: draft.tool,
          entry,
          target,
          stop,
          entryTime: a.time,
          ...styleBase,
        });
      }
      setDraft(null);
    }

    if (e.type === "pointerup" && draft?.tool === "pen") {
      commitObject({ id: uid(), tool: "pen", points: draft.points, ...styleBase });
      setDraft(null);
    }
  };

  useEffect(() => {
    if (!drag) return;
    const onUp = () => setDrag(null);
    window.addEventListener("pointerup", onUp);
    return () => window.removeEventListener("pointerup", onUp);
  }, [drag]);

  const vpMax = Math.max(...volumeProfile.map((v) => v.weightPct), 1);

  return (
    <div ref={wrapRef} className="flex flex-col md:flex-row">
      <div className="relative min-w-0 flex-1">
        <svg
          width="100%"
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="touch-none bg-surface"
          onPointerDown={handlePointer}
          onPointerMove={handlePointer}
          onPointerUp={handlePointer}
        >
          {/* grid */}
          {[0.25, 0.5, 0.75].map((r) => {
            const y = layout.paddingTop + plotH(layout) * r;
            return <line key={r} x1={layout.paddingLeft} x2={layout.width - layout.paddingRight} y1={y} y2={y} stroke="#e2e8f0" />;
          })}

          {/* volume profile overlay */}
          {showVp &&
            volumeProfile.map((lvl, i) => {
              const y = priceToY(lvl.price, scales, layout);
              const w = (lvl.weightPct / vpMax) * 48;
              return (
                <rect
                  key={i}
                  x={layout.paddingLeft - w - 4}
                  y={y - 2}
                  width={w}
                  height={4}
                  fill="#1428A0"
                  opacity={0.25}
                />
              );
            })}

          {/* bollinger */}
          {showBb &&
            bars.map((bar, i) => {
              if (bar.bbUpper == null || bar.bbLower == null) return null;
              const x = timeToX(bar.time, scales, layout);
              const yU = priceToY(bar.bbUpper, scales, layout);
              const yL = priceToY(bar.bbLower, scales, layout);
              return <line key={i} x1={x} x2={x} y1={yU} y2={yL} stroke="#94a3b8" strokeWidth={1} opacity={0.35} />;
            })}

          {/* candles */}
          {bars.map((bar) => {
            const x = timeToX(bar.time, scales, layout);
            const yO = priceToY(bar.open, scales, layout);
            const yC = priceToY(bar.close, scales, layout);
            const yH = priceToY(bar.high, scales, layout);
            const yL = priceToY(bar.low, scales, layout);
            const up = bar.close >= bar.open;
            const color = up ? "#ef4444" : "#2563eb";
            return (
              <g key={bar.time}>
                <line x1={x} x2={x} y1={yH} y2={yL} stroke={color} strokeWidth={1} />
                <rect
                  x={x - candleW / 2}
                  y={Math.min(yO, yC)}
                  width={candleW}
                  height={Math.max(1, Math.abs(yC - yO))}
                  fill={up ? color : color}
                  stroke={color}
                />
              </g>
            );
          })}

          {/* SMA overlay */}
          {showSma && ["sma5", "sma20", "sma60", "sma120"].map((key, idx) => {
            const colors = ["#f97316", "#2563eb", "#8b5cf6", "#059669"];
            const pts = bars
              .map((bar) => {
                const v = bar[key as keyof EnrichedBar] as number | null;
                if (v == null) return null;
                return `${timeToX(bar.time, scales, layout)},${priceToY(v, scales, layout)}`;
              })
              .filter(Boolean)
              .join(" ");
            return <polyline key={key} points={pts} fill="none" stroke={colors[idx]} strokeWidth={1.2} />;
          })}

          {/* streak markers */}
          {showStreak &&
            streakMarkers.map((m) => {
              const x = timeToX(m.time, scales, layout);
              const bar = bars.find((b) => b.time === m.time);
              if (!bar) return null;
              const y = priceToY(bar.high, scales, layout) - 8;
              return (
                <text key={`${m.time}-${m.kind}`} x={x} y={y} fontSize={10} textAnchor="middle" fill={m.kind === "up3" ? "#ef4444" : "#2563eb"}>
                  {m.kind === "up3" ? "▲3" : "▼3"}
                </text>
              );
            })}

          {/* drawings */}
          {drawingDoc.objects.map((obj) => renderDrawing(obj, scales, layout, obj.id === selectedId))}
        </svg>
        <p className="border-t border-border px-3 py-1 text-[10px] text-fg-muted">
          {currency} · OHLC 캔들 · as-of 차트 데이터 기준
          {showVp && " · 매물대: 최근 구간 거래량 binning(참고용)"}
        </p>
      </div>

      <TickerDrawingToolbar
        vertical
        tool={tool}
        onToolChange={setTool}
        color={styleBase.color}
        strokeWidth={styleBase.strokeWidth}
        showLabels={styleBase.showLabels}
        onStyleChange={(patch) =>
          onDrawingChange({ ...drawingDoc, style: { ...styleBase, ...patch }, updatedAt: new Date().toISOString() })
        }
        onClear={() => onDrawingChange({ ...drawingDoc, objects: [], updatedAt: new Date().toISOString() })}
      />

      <TickerDrawingToolbar
        vertical={false}
        tool={tool}
        onToolChange={setTool}
        color={styleBase.color}
        strokeWidth={styleBase.strokeWidth}
        showLabels={styleBase.showLabels}
        onStyleChange={(patch) =>
          onDrawingChange({ ...drawingDoc, style: { ...styleBase, ...patch }, updatedAt: new Date().toISOString() })
        }
        onClear={() => onDrawingChange({ ...drawingDoc, objects: [], updatedAt: new Date().toISOString() })}
      />
    </div>
  );
}

function plotH(layout: ChartLayout) {
  return layout.height - layout.paddingTop - layout.paddingBottom;
}
