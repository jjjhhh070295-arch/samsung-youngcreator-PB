"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { EnrichedBar } from "@/lib/advisory/tickerIndicatorsExtended";
import type { IndicatorKind } from "@/lib/advisory/tickerAnalysisPresets";
import {
  defaultLayout,
  nearestBarIndex,
  pointerToTP,
  pointerToTPFromSvg,
  plotWidth,
  priceToY,
  scalesFromBars,
  timeToX,
  type ChartLayout,
} from "@/lib/advisory/chartCoords";
import { formatChartPrice, formatChartVolume, priceAxisTicks } from "@/lib/advisory/chartPriceFormat";
import { downloadSvgAsPng } from "@/lib/advisory/chartExport";
import {
  chartExportFilename,
  timeframeLabel,
  type OhlcTimeframe,
} from "@/lib/advisory/ohlcAggregate";
import {
  DRAFT_DASH,
  DRAFT_OPACITY,
  FIB_LEVELS,
  HIT_TEST_THRESHOLD_PX,
  MIN_DRAWING_DRAG_PX,
  MIN_PEN_PATH_PX,
  MIN_SELECT_MOVE_PX,
  positionRiskReward,
  SELECTED_STROKE,
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

type DrawingDraft = {
  tool: DrawingTool;
  start: PointTP;
  current: PointTP;
  points: PointTP[];
  pointerId: number;
  startPx: { x: number; y: number };
};

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

function hitThreshold(obj: DrawingObject) {
  return Math.max(HIT_TEST_THRESHOLD_PX, obj.strokeWidth + 8);
}

function inPlotX(x: number, layout: ChartLayout, pad = 0) {
  return x >= layout.paddingLeft - pad && x <= layout.width - layout.paddingRight + pad;
}

function findHitDrawing(
  objects: DrawingObject[],
  x: number,
  y: number,
  scales: ChartScales,
  layout: ChartLayout,
) {
  return [...objects].reverse().find((obj) => hitDrawing(obj, x, y, scales, layout)) ?? null;
}

function hitDrawing(obj: DrawingObject, x: number, y: number, scales: ChartScales, layout: ChartLayout) {
  const threshold = hitThreshold(obj);
  switch (obj.tool) {
    case "pen": {
      for (const point of obj.points) {
        const p = pointToXY(point, scales, layout);
        if (Math.hypot(x - p.x, y - p.y) <= threshold) return true;
      }
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
      const topY = priceToY(top, scales, layout);
      const bottomY = priceToY(bottom, scales, layout);
      if (y >= topY - threshold && y <= bottomY + threshold) return true;
      return FIB_LEVELS.some((lv) => {
        const price = bottom + (top - bottom) * (1 - lv);
        return Math.abs(priceToY(price, scales, layout) - y) <= threshold;
      });
    }
    case "hline": {
      if (!inPlotX(x, layout, threshold)) return false;
      return Math.abs(priceToY(obj.price, scales, layout) - y) <= threshold;
    }
    case "vline": {
      const vx = timeToX(obj.time, scales, layout);
      if (Math.abs(vx - x) > threshold) return false;
      return y >= layout.paddingTop - threshold && y <= layout.height - layout.paddingBottom + threshold;
    }
    case "long":
    case "short": {
      const entryX = timeToX(obj.entryTime, scales, layout);
      const entryY = priceToY(obj.entry, scales, layout);
      const targetY = priceToY(obj.target, scales, layout);
      const stopY = priceToY(obj.stop, scales, layout);
      const left = entryX - 40;
      const right = entryX + 72;
      const top = Math.min(entryY, targetY, stopY) - threshold;
      const bottom = Math.max(entryY, targetY, stopY) + threshold;
      if (x >= left && x <= right && y >= top && y <= bottom) return true;
      return (
        distanceToSegment(x, y, entryX - 30, entryY, entryX + 30, entryY) <= threshold ||
        distanceToSegment(x, y, entryX - 30, targetY, entryX + 30, targetY) <= threshold ||
        distanceToSegment(x, y, entryX - 30, stopY, entryX + 30, stopY) <= threshold
      );
    }
    default:
      return false;
  }
}

function penPathLengthPx(points: PointTP[], scales: ChartScales, layout: ChartLayout) {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    const a = pointToXY(points[i - 1], scales, layout);
    const b = pointToXY(points[i], scales, layout);
    len += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return len;
}

function dragDistancePx(draft: DrawingDraft, currentPx: { x: number; y: number }) {
  return Math.hypot(currentPx.x - draft.startPx.x, currentPx.y - draft.startPx.y);
}

function positionFromDrag(tool: "long" | "short", start: PointTP, current: PointTP) {
  const entry = start.price;
  const target = current.price;
  const risk = Math.abs(target - entry) || Math.max(entry * 0.01, 1);
  const stop = tool === "long" ? entry - risk : entry + risk;
  return { entry, target, stop, entryTime: start.time };
}

function selectionAnchors(obj: DrawingObject, scales: ChartScales, layout: ChartLayout) {
  const r = 4;
  const fill = SELECTED_STROKE;
  const anchors: Array<{ x: number; y: number }> = [];
  switch (obj.tool) {
    case "pen":
      if (obj.points.length > 0) {
        anchors.push(pointToXY(obj.points[0], scales, layout));
        if (obj.points.length > 1) anchors.push(pointToXY(obj.points[obj.points.length - 1], scales, layout));
      }
      break;
    case "trendline":
      anchors.push(pointToXY(obj.a, scales, layout), pointToXY(obj.b, scales, layout));
      break;
    case "parallel_channel":
      anchors.push(pointToXY(obj.a, scales, layout), pointToXY(obj.b, scales, layout));
      break;
    case "fibonacci":
      anchors.push(pointToXY(obj.high, scales, layout), pointToXY(obj.low, scales, layout));
      break;
    case "hline":
      anchors.push({ x: layout.paddingLeft + plotWidth(layout) / 2, y: priceToY(obj.price, scales, layout) });
      break;
    case "vline":
      anchors.push({ x: timeToX(obj.time, scales, layout), y: layout.paddingTop + (layout.height - layout.paddingTop - layout.paddingBottom) / 2 });
      break;
    case "long":
    case "short":
      anchors.push({ x: timeToX(obj.entryTime, scales, layout), y: priceToY(obj.entry, scales, layout) });
      break;
    default:
      break;
  }
  return anchors.map((a, i) => (
    <circle key={`${obj.id}-anchor-${i}`} cx={a.x} cy={a.y} r={r} fill={fill} stroke="#fff" strokeWidth={1.5} />
  ));
}

function renderDrawing(
  obj: DrawingObject,
  scales: ChartScales,
  layout: ChartLayout,
  selected: boolean,
  preview = false,
) {
  const stroke = selected && !preview ? SELECTED_STROKE : obj.color;
  const sw = selected && !preview ? obj.strokeWidth + 0.5 : obj.strokeWidth;
  const dash = preview ? DRAFT_DASH : selected ? "6 3" : undefined;
  const opacity = preview ? DRAFT_OPACITY : 1;

  switch (obj.tool) {
    case "pen": {
      const pts = obj.points
        .map((p) => `${timeToX(p.time, scales, layout)},${priceToY(p.price, scales, layout)}`)
        .join(" ");
      return (
        <g key={obj.id}>
          <polyline
            points={pts}
            fill="none"
            stroke={stroke}
            strokeWidth={sw}
            strokeDasharray={dash}
            opacity={opacity}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {selected && !preview && selectionAnchors(obj, scales, layout)}
        </g>
      );
    }
    case "trendline": {
      const x1 = timeToX(obj.a.time, scales, layout);
      const y1 = priceToY(obj.a.price, scales, layout);
      const x2 = timeToX(obj.b.time, scales, layout);
      const y2 = priceToY(obj.b.price, scales, layout);
      return (
        <g key={obj.id}>
          <line
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            stroke={stroke}
            strokeWidth={sw}
            strokeDasharray={dash}
            opacity={opacity}
          />
          {selected && !preview && selectionAnchors(obj, scales, layout)}
        </g>
      );
    }
    case "parallel_channel": {
      const x1 = timeToX(obj.a.time, scales, layout);
      const y1 = priceToY(obj.a.price, scales, layout);
      const x2 = timeToX(obj.b.time, scales, layout);
      const y2 = priceToY(obj.b.price, scales, layout);
      const yOff = priceToY(obj.a.price + obj.offsetPrice, scales, layout) - y1;
      return (
        <g key={obj.id} opacity={opacity}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
          <line x1={x1} y1={y1 + yOff} x2={x2} y2={y2 + yOff} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} opacity={0.75} />
          {selected && !preview && selectionAnchors(obj, scales, layout)}
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
        <g key={obj.id} opacity={opacity}>
          {FIB_LEVELS.map((lv) => {
            const price = bottom + (top - bottom) * (1 - lv);
            const y = priceToY(price, scales, layout);
            return (
              <g key={lv}>
                <line x1={left} y1={y} x2={right} y2={y} stroke={stroke} strokeWidth={selected ? 1.5 : 1} strokeDasharray={dash} />
                {(obj.showLabels || preview) && (
                  <text x={right + 4} y={y + 3} fontSize={9} fill={stroke} opacity={0.9}>
                    {(lv * 100).toFixed(1)}%
                  </text>
                )}
              </g>
            );
          })}
          {selected && !preview && selectionAnchors(obj, scales, layout)}
        </g>
      );
    }
    case "hline": {
      const y = priceToY(obj.price, scales, layout);
      return (
        <g key={obj.id} opacity={opacity}>
          <line
            x1={layout.paddingLeft}
            y1={y}
            x2={layout.width - layout.paddingRight}
            y2={y}
            stroke={stroke}
            strokeWidth={sw}
            strokeDasharray={dash}
          />
          {obj.showLabels && !preview && (
            <text x={layout.width - layout.paddingRight + 2} y={y + 3} fontSize={9} fill={stroke}>
              {obj.price.toLocaleString("ko-KR")}
            </text>
          )}
          {selected && !preview && selectionAnchors(obj, scales, layout)}
        </g>
      );
    }
    case "vline": {
      const x = timeToX(obj.time, scales, layout);
      return (
        <g key={obj.id} opacity={opacity}>
          <line
            x1={x}
            y1={layout.paddingTop}
            x2={x}
            y2={layout.height - layout.paddingBottom}
            stroke={stroke}
            strokeWidth={sw}
            strokeDasharray={dash}
          />
          {obj.showLabels && !preview && (
            <text x={x + 2} y={layout.paddingTop + 10} fontSize={9} fill={stroke}>
              {obj.time.slice(5)}
            </text>
          )}
          {selected && !preview && selectionAnchors(obj, scales, layout)}
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
        <g key={obj.id} opacity={opacity}>
          <rect x={x - 20} y={Math.min(entryY, targetY)} width={40} height={Math.abs(targetY - entryY) || 1} fill={fill} />
          <line x1={x - 30} y1={entryY} x2={x + 30} y2={entryY} stroke={stroke} strokeWidth={sw} strokeDasharray={dash} />
          <line x1={x - 30} y1={targetY} x2={x + 30} y2={targetY} stroke="#16a34a" strokeWidth={1.5} strokeDasharray={selected ? "6 3" : "3 2"} />
          <line x1={x - 30} y1={stopY} x2={x + 30} y2={stopY} stroke="#dc2626" strokeWidth={1.5} strokeDasharray={selected ? "6 3" : "3 2"} />
          {(obj.showLabels || preview) && rr.ratio != null && (
            <text x={x + 34} y={entryY} fontSize={9} fill={stroke}>
              R:R {rr.ratio.toFixed(2)}
            </text>
          )}
          {selected && !preview && selectionAnchors(obj, scales, layout)}
        </g>
      );
    }
    default:
      return null;
  }
}

function draftToPreviewObject(draft: DrawingDraft, style: DrawingDocument["style"]): DrawingObject | null {
  const base = {
    id: "draft-preview",
    color: style.color,
    strokeWidth: style.strokeWidth,
    showLabels: style.showLabels,
  };

  switch (draft.tool) {
    case "pen":
      return { ...base, tool: "pen", points: draft.points };
    case "trendline":
      return { ...base, tool: "trendline", a: draft.start, b: draft.current };
    case "parallel_channel":
      return {
        ...base,
        tool: "parallel_channel",
        a: draft.start,
        b: draft.current,
        offsetPrice: (draft.current.price - draft.start.price) * 0.35,
      };
    case "fibonacci": {
      const high = draft.start.price > draft.current.price ? draft.start : draft.current;
      const low = draft.start.price > draft.current.price ? draft.current : draft.start;
      return { ...base, tool: "fibonacci", high, low };
    }
    case "hline":
      return { ...base, tool: "hline", price: draft.current.price };
    case "vline":
      return { ...base, tool: "vline", time: draft.current.time };
    case "long":
    case "short": {
      const pos = positionFromDrag(draft.tool, draft.start, draft.current);
      return { ...base, tool: draft.tool, ...pos };
    }
    default:
      return null;
  }
}

function commitDraft(draft: DrawingDraft, style: DrawingDocument["style"]): DrawingObject | null {
  const preview = draftToPreviewObject(draft, style);
  if (!preview) return null;
  return { ...preview, id: uid() };
}

export type TickerCandleChartHandle = {
  exportPng: (meta: { symbol: string; name: string; timeframe: OhlcTimeframe }) => Promise<void>;
};

export const TickerCandleChart = forwardRef<TickerCandleChartHandle, {
  bars: EnrichedBar[];
  overlayKinds: IndicatorKind[];
  streakMarkers: Array<{ time: string; kind: "up3" | "down3" }>;
  volumeProfile: Array<{ price: number; volume: number; weightPct: number }>;
  drawingDoc: DrawingDocument;
  onDrawingChange: (doc: DrawingDocument) => void;
  currency: string;
  latestPrice?: number;
  compact?: boolean;
  enableDrawings?: boolean;
  title?: string;
}>(function TickerCandleChart(
  {
  bars,
  overlayKinds,
  streakMarkers,
  volumeProfile,
  drawingDoc,
  onDrawingChange,
  currency,
  latestPrice,
  compact = false,
  enableDrawings = true,
  title,
},
  ref,
) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 720, h: 360 });
  const [tool, setTool] = useState<DrawingTool>("select");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DrawingDraft | null>(null);
  const [drag, setDrag] = useState<{
    id: string;
    start: PointTP;
    startPx: { x: number; y: number };
    orig: DrawingObject;
  } | null>(null);
  const [hoverHitId, setHoverHitId] = useState<string | null>(null);
  const [inspect, setInspect] = useState<{
    x: number;
    y: number;
    barIndex: number;
    price: number;
  } | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: compact ? 220 : 360 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [compact]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDraft(null);
        setDrag(null);
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const layout = useMemo(() => defaultLayout(size.w, size.h, { compact }), [size, compact]);
  const scales = useMemo(() => scalesFromBars(bars), [bars]);
  const axisTicks = useMemo(
    () => priceAxisTicks(scales.minPrice, scales.maxPrice, compact ? 4 : 6),
    [scales.minPrice, scales.maxPrice, compact],
  );
  const lastClose = bars.length ? bars[bars.length - 1].close : null;
  const refPrice = latestPrice ?? lastClose;
  const candleW = Math.max(2, (layout.width - layout.paddingLeft - layout.paddingRight) / Math.max(bars.length, 1) * 0.6);

  const showSma = overlayKinds.includes("sma");
  const showBb = overlayKinds.includes("bollinger");
  const showVp = overlayKinds.includes("volume_profile");
  const showStreak = overlayKinds.includes("streak");

  const styleBase = drawingDoc.style;

  useImperativeHandle(
    ref,
    () => ({
      exportPng: async ({ symbol, name, timeframe }) => {
        const svg = svgRef.current;
        if (!svg) return;
        await downloadSvgAsPng(svg, {
          filename: chartExportFilename(symbol, timeframe),
          title: `${name} (${symbol})`,
          subtitle: `${timeframeLabel(timeframe)} · ${currency}`,
        });
      },
    }),
    [currency],
  );

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

  const pointerTp = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (svg) return pointerToTPFromSvg(svg, e.clientX, e.clientY, scales, layout);
    const rect = e.currentTarget.getBoundingClientRect();
    return pointerToTP(e.clientX, e.clientY, rect, scales, layout);
  };

  const updateInspect = useCallback(
    (tp: { x: number; y: number; price: number }) => {
      const inPlot =
        tp.x >= layout.paddingLeft &&
        tp.x <= layout.width - layout.paddingRight &&
        tp.y >= layout.paddingTop &&
        tp.y <= layout.height - layout.paddingBottom;
      if (!inPlot || draft || drag) {
        setInspect(null);
        return;
      }
      setInspect({
        x: tp.x,
        y: tp.y,
        barIndex: nearestBarIndex(tp.x, scales, layout),
        price: tp.price,
      });
    },
    [layout, scales, draft, drag],
  );

  const replaceObject = useCallback(
    (id: string, next: DrawingObject) => {
      onDrawingChange({
        ...drawingDoc,
        objects: drawingDoc.objects.map((obj) => (obj.id === id ? next : obj)),
        updatedAt: new Date().toISOString(),
      });
    },
    [drawingDoc, onDrawingChange],
  );

  const removeObject = useCallback(
    (id: string) => {
      onDrawingChange({
        ...drawingDoc,
        objects: drawingDoc.objects.filter((obj) => obj.id !== id),
        updatedAt: new Date().toISOString(),
      });
      if (selectedId === id) setSelectedId(null);
    },
    [drawingDoc, onDrawingChange, selectedId],
  );

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const tp = pointerTp(e);
    if (!enableDrawings) {
      updateInspect(tp);
      return;
    }

    if (tool === "erase") {
      if (selectedId) {
        removeObject(selectedId);
        return;
      }
      const hit = findHitDrawing(drawingDoc.objects, tp.x, tp.y, scales, layout);
      if (!hit) return;
      removeObject(hit.id);
      return;
    }

    if (tool === "select") {
      const hit = findHitDrawing(drawingDoc.objects, tp.x, tp.y, scales, layout);
      setSelectedId(hit?.id ?? null);
      setHoverHitId(hit?.id ?? null);
      if (!hit) {
        setDrag(null);
        return;
      }
      setDrag({ id: hit.id, start: { time: tp.time, price: tp.price }, startPx: { x: tp.x, y: tp.y }, orig: hit });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const startPoint: PointTP = { time: tp.time, price: tp.price };
    setDraft({
      tool,
      start: startPoint,
      current: startPoint,
      points: [startPoint],
      pointerId: e.pointerId,
      startPx: { x: tp.x, y: tp.y },
    });
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const tp = pointerTp(e);

    if (tool === "select") {
      if (drag) {
        replaceObject(
          drag.id,
          moveDrawing(drag.orig, drag.start, { time: tp.time, price: tp.price }, scales),
        );
        setInspect(null);
        return;
      }
      const hit = findHitDrawing(drawingDoc.objects, tp.x, tp.y, scales, layout);
      setHoverHitId(hit?.id ?? null);
      if (!hit) updateInspect(tp);
      else setInspect(null);
      return;
    }

    if (tool === "erase") {
      const hit = findHitDrawing(drawingDoc.objects, tp.x, tp.y, scales, layout);
      setHoverHitId(hit?.id ?? null);
      updateInspect(tp);
      return;
    }

    setHoverHitId(null);
    setInspect(null);

    if (!draft || draft.pointerId !== e.pointerId) {
      if (!draft && !drag) updateInspect(tp);
      return;
    }

    if (draft.tool === "pen") {
      setDraft((d) =>
        d
          ? {
              ...d,
              current: { time: tp.time, price: tp.price },
              points: [...d.points, { time: tp.time, price: tp.price }],
            }
          : d,
      );
      return;
    }

    setDraft((d) => (d ? { ...d, current: { time: tp.time, price: tp.price } } : d));
  };

  const finishDraft = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!draft || draft.pointerId !== e.pointerId) return;
    const tp = pointerTp(e);

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }

    if (draft.tool === "pen") {
      if (penPathLengthPx(draft.points, scales, layout) >= MIN_PEN_PATH_PX) {
        const obj = commitDraft({ ...draft, current: { time: tp.time, price: tp.price } }, styleBase);
        if (obj) commitObject(obj);
      }
      setDraft(null);
      return;
    }

    const dist = dragDistancePx(draft, { x: tp.x, y: tp.y });
    if (dist >= MIN_DRAWING_DRAG_PX) {
      const finalDraft = { ...draft, current: { time: tp.time, price: tp.price } };
      const obj = commitDraft(finalDraft, styleBase);
      if (obj) commitObject(obj);
    }
    setDraft(null);
  };

  const handlePointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    if (tool === "select") {
      if (drag) {
        const tp = pointerTp(e);
        const movedPx = Math.hypot(tp.x - drag.startPx.x, tp.y - drag.startPx.y);
        if (movedPx < MIN_SELECT_MOVE_PX) {
          replaceObject(drag.id, drag.orig);
        }
        try {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
        } catch {
          // ignore
        }
      }
      setDrag(null);
      return;
    }
    finishDraft(e);
  };

  const handlePointerCancel = (e: React.PointerEvent<SVGSVGElement>) => {
    if (draft?.pointerId === e.pointerId) setDraft(null);
    if (drag) {
      replaceObject(drag.id, drag.orig);
      setDrag(null);
    }
  };

  const draftPreview = draft ? draftToPreviewObject(draft, styleBase) : null;
  const vpMax = Math.max(...volumeProfile.map((v) => v.weightPct), 1);
  const inspectBar = inspect ? bars[inspect.barIndex] : null;
  const axisX = layout.width - layout.paddingRight + 4;
  const chartCursor = !enableDrawings
    ? "crosshair"
    : tool === "select"
      ? drag
        ? "grabbing"
        : hoverHitId
          ? "grab"
          : "default"
      : tool === "erase"
        ? hoverHitId
          ? "pointer"
          : "default"
        : "crosshair";

  return (
    <div ref={wrapRef} className="flex flex-col md:flex-row">
      <div className="relative min-w-0 flex-1">
        <svg
          ref={svgRef}
          width="100%"
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="touch-none bg-surface"
          style={{ cursor: chartCursor }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={() => {
            if (!drag) {
              setHoverHitId(null);
              setInspect(null);
            }
          }}
        >
          <g pointerEvents="none">
          {axisTicks.map((tick) => {
            const y = priceToY(tick, scales, layout);
            return (
              <g key={tick}>
                <line
                  x1={layout.paddingLeft}
                  x2={layout.width - layout.paddingRight}
                  y1={y}
                  y2={y}
                  stroke="#e2e8f0"
                  strokeDasharray="2 4"
                />
                <text x={axisX} y={y + 3} fontSize={compact ? 9 : 10} fill="#64748b">
                  {formatChartPrice(tick, currency)}
                </text>
              </g>
            );
          })}

          {refPrice != null && (
            <g>
              <line
                x1={layout.paddingLeft}
                x2={layout.width - layout.paddingRight}
                y1={priceToY(refPrice, scales, layout)}
                y2={priceToY(refPrice, scales, layout)}
                stroke="#1428A0"
                strokeWidth={1}
                strokeDasharray="4 3"
                opacity={0.85}
              />
              <rect
                x={axisX - 2}
                y={priceToY(refPrice, scales, layout) - 9}
                width={layout.paddingRight - 6}
                height={16}
                rx={3}
                fill="#1428A0"
              />
              <text
                x={axisX + 2}
                y={priceToY(refPrice, scales, layout) + 3}
                fontSize={compact ? 9 : 10}
                fontWeight={600}
                fill="#fff"
              >
                {formatChartPrice(refPrice, currency)}
              </text>
            </g>
          )}

          {showVp &&
            volumeProfile.map((lvl, i) => {
              const y = priceToY(lvl.price, scales, layout);
              const w = (lvl.weightPct / vpMax) * 48;
              return (
                <rect key={i} x={layout.paddingLeft - w - 4} y={y - 2} width={w} height={4} fill="#1428A0" opacity={0.25} />
              );
            })}

          {showBb &&
            bars.map((bar, i) => {
              if (bar.bbUpper == null || bar.bbLower == null) return null;
              const x = timeToX(bar.time, scales, layout);
              const yU = priceToY(bar.bbUpper, scales, layout);
              const yL = priceToY(bar.bbLower, scales, layout);
              return <line key={i} x1={x} x2={x} y1={yU} y2={yL} stroke="#94a3b8" strokeWidth={1} opacity={0.35} />;
            })}

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
                  fill={color}
                  stroke={color}
                />
              </g>
            );
          })}

          {showSma &&
            ["sma5", "sma20", "sma60", "sma120"].map((key, idx) => {
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
          </g>

          {enableDrawings &&
            drawingDoc.objects.map((obj) => renderDrawing(obj, scales, layout, obj.id === selectedId))}

          {enableDrawings && draftPreview && renderDrawing(draftPreview, scales, layout, false, true)}

          {inspect && !draft && !drag && (
            <g pointerEvents="none">
              <line
                x1={inspect.x}
                x2={inspect.x}
                y1={layout.paddingTop}
                y2={layout.height - layout.paddingBottom}
                stroke="#1428A0"
                strokeWidth={1}
                opacity={0.45}
              />
              <line
                x1={layout.paddingLeft}
                x2={layout.width - layout.paddingRight}
                y1={inspect.y}
                y2={inspect.y}
                stroke="#1428A0"
                strokeWidth={1}
                opacity={0.45}
              />
              <rect
                x={axisX - 2}
                y={inspect.y - 9}
                width={layout.paddingRight - 6}
                height={16}
                rx={3}
                fill="#0f172a"
                opacity={0.92}
              />
              <text x={axisX + 2} y={inspect.y + 3} fontSize={compact ? 9 : 10} fontWeight={600} fill="#fff">
                {formatChartPrice(inspect.price, currency)}
              </text>
            </g>
          )}
        </svg>

        {inspect && inspectBar && (
          <div
            className="pointer-events-none absolute z-10 min-w-[148px] rounded-lg border border-border bg-white/95 px-2.5 py-2 text-[11px] shadow-sm backdrop-blur-sm"
            style={{
              left: `${Math.min(Math.max((inspect.x / layout.width) * 100, 8), 72)}%`,
              top: Math.max(8, inspect.y - 88),
            }}
          >
            {title && <p className="mb-1 font-bold text-[#1428A0]">{title}</p>}
            <p className="font-semibold text-fg">{inspectBar.time}</p>
            <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-fg-muted">
              <span>O</span>
              <span className="text-right font-medium text-fg">
                {formatChartPrice(inspectBar.open, currency)}
              </span>
              <span>H</span>
              <span className="text-right font-medium text-fg">
                {formatChartPrice(inspectBar.high, currency)}
              </span>
              <span>L</span>
              <span className="text-right font-medium text-fg">
                {formatChartPrice(inspectBar.low, currency)}
              </span>
              <span>C</span>
              <span className="text-right font-medium text-fg">
                {formatChartPrice(inspectBar.close, currency)}
              </span>
              <span>Vol</span>
              <span className="text-right font-medium text-fg">{formatChartVolume(inspectBar.volume)}</span>
            </div>
          </div>
        )}
        <p className="border-t border-border px-3 py-1 text-[10px] text-fg-muted">
          {currency} · OHLC 캔들
          {enableDrawings && " · Esc 드로잉/선택 취소"}
          {enableDrawings && tool === "select" && " · 선택/이동: 도형 클릭 후 드래그"}
          {showVp && " · 매물대: 최근 구간 거래량 binning(참고용)"}
        </p>
      </div>

      {enableDrawings && (
        <>
      <TickerDrawingToolbar
        vertical
        tool={tool}
        onToolChange={(t) => {
          setDraft(null);
          setDrag(null);
          if (t !== "select" && t !== "erase") setSelectedId(null);
          setHoverHitId(null);
          setTool(t);
        }}
        color={styleBase.color}
        strokeWidth={styleBase.strokeWidth}
        showLabels={styleBase.showLabels}
        onStyleChange={(patch) =>
          onDrawingChange({ ...drawingDoc, style: { ...styleBase, ...patch }, updatedAt: new Date().toISOString() })
        }
        onClear={() => {
          onDrawingChange({ ...drawingDoc, objects: [], updatedAt: new Date().toISOString() });
          setSelectedId(null);
          setHoverHitId(null);
          setDrag(null);
        }}
      />

      <TickerDrawingToolbar
        vertical={false}
        tool={tool}
        onToolChange={(t) => {
          setDraft(null);
          setDrag(null);
          if (t !== "select" && t !== "erase") setSelectedId(null);
          setHoverHitId(null);
          setTool(t);
        }}
        color={styleBase.color}
        strokeWidth={styleBase.strokeWidth}
        showLabels={styleBase.showLabels}
        onStyleChange={(patch) =>
          onDrawingChange({ ...drawingDoc, style: { ...styleBase, ...patch }, updatedAt: new Date().toISOString() })
        }
        onClear={() => {
          onDrawingChange({ ...drawingDoc, objects: [], updatedAt: new Date().toISOString() });
          setSelectedId(null);
          setHoverHitId(null);
          setDrag(null);
        }}
      />
        </>
      )}
    </div>
  );
});

TickerCandleChart.displayName = "TickerCandleChart";

function plotH(layout: ChartLayout) {
  return layout.height - layout.paddingTop - layout.paddingBottom;
}
