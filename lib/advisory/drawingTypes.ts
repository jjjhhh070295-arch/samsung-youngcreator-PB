export type DrawingTool =
  | "select"
  | "pen"
  | "trendline"
  | "parallel_channel"
  | "fibonacci"
  | "hline"
  | "vline"
  | "long"
  | "short"
  | "erase";

export interface DrawingStyle {
  color: string;
  strokeWidth: number;
  showLabels: boolean;
}

export interface PointTP {
  time: string;
  price: number;
}

export interface BaseDrawing {
  id: string;
  tool: DrawingTool;
  color: string;
  strokeWidth: number;
  showLabels: boolean;
}

export interface PenDrawing extends BaseDrawing {
  tool: "pen";
  points: PointTP[];
}

export interface TrendLineDrawing extends BaseDrawing {
  tool: "trendline";
  a: PointTP;
  b: PointTP;
}

export interface ParallelChannelDrawing extends BaseDrawing {
  tool: "parallel_channel";
  a: PointTP;
  b: PointTP;
  offsetPrice: number;
}

export interface FibonacciDrawing extends BaseDrawing {
  tool: "fibonacci";
  high: PointTP;
  low: PointTP;
}

export interface HLineDrawing extends BaseDrawing {
  tool: "hline";
  price: number;
}

export interface VLineDrawing extends BaseDrawing {
  tool: "vline";
  time: string;
}

export interface PositionDrawing extends BaseDrawing {
  tool: "long" | "short";
  entry: number;
  target: number;
  stop: number;
  entryTime: string;
}

export type DrawingObject =
  | PenDrawing
  | TrendLineDrawing
  | ParallelChannelDrawing
  | FibonacciDrawing
  | HLineDrawing
  | VLineDrawing
  | PositionDrawing;

export interface DrawingDocument {
  version: 1;
  objects: DrawingObject[];
  style: DrawingStyle;
  updatedAt: string;
}

export const FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

/** Minimum pointer travel (px) before a two-point drawing is committed. */
export const MIN_DRAWING_DRAG_PX = 8;

/** Minimum pen path length (px) before commit. */
export const MIN_PEN_PATH_PX = 12;

export const DRAFT_DASH = "6 4";
export const DRAFT_OPACITY = 0.55;

/** Pixel distance for line/path hit testing in selection mode. */
export const HIT_TEST_THRESHOLD_PX = 10;

/** Minimum drag travel before a move is committed (smaller drags = select only). */
export const MIN_SELECT_MOVE_PX = 4;

/** Highlight color for selected drawings. */
export const SELECTED_STROKE = "#1428A0";

export function positionRiskReward(entry: number, target: number, stop: number) {
  const reward = Math.abs(target - entry);
  const risk = Math.abs(entry - stop);
  if (risk <= 0) return { reward, risk, ratio: null };
  return { reward, risk, ratio: reward / risk };
}
