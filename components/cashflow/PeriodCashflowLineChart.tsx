"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PeriodCashflowChartPoint, PeriodCashflowPoint } from "@/lib/periodCashflow";
import { toPeriodCashflowChartData } from "@/lib/periodCashflow";

export const LINE_COLORS = {
  income: "#2563eb",
  tax: "#8b5cf6",
  outflow: "#ef4444",
  saving: "#f59e0b",
  net: "#0f172a",
} as const;

const plottedValues = (point: PeriodCashflowChartPoint) => [
  point.incomePlotManwon,
  point.outflowPlotManwon,
  point.savingPlotManwon,
  point.taxPlotManwon,
  point.netPlotManwon,
];

const computeZeroBasedDomain = (chartData: PeriodCashflowChartPoint[]): [number, number] => {
  const values = chartData.flatMap(plottedValues);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const min = rawMin < 0 ? rawMin : 0;
  const max = rawMax > 0 ? rawMax : 0;
  const span = max - min || Math.max(Math.abs(max), Math.abs(min), 1);
  const padding = Math.max(1, Math.ceil(span * 0.1));
  return [min < 0 ? Math.floor(min - padding) : 0, Math.ceil(max + padding)];
};

export default function PeriodCashflowLineChart({
  series,
  className = "h-80",
}: {
  series: PeriodCashflowPoint[];
  className?: string;
}) {
  const chartData = toPeriodCashflowChartData(series);
  const yDomain = computeZeroBasedDomain(chartData);

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 14, bottom: 0, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.35)" />
          <XAxis dataKey="period" tick={{ fontSize: 10 }} />
          <YAxis
            domain={yDomain}
            tick={{ fontSize: 10 }}
            tickFormatter={(value) => `${Number(value).toLocaleString()}만`}
          />
          <ReferenceLine y={0} stroke="#111827" strokeWidth={2} ifOverflow="extendDomain" />
          <Tooltip formatter={(value: unknown) => `${Number(value).toLocaleString()}만원`} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
          <Line type="monotone" dataKey="incomePlotManwon" name="유입" stroke={LINE_COLORS.income} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="outflowPlotManwon" name="유출" stroke={LINE_COLORS.outflow} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="savingPlotManwon" name="저축/투자" stroke={LINE_COLORS.saving} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="taxPlotManwon" name="세금" stroke={LINE_COLORS.tax} strokeWidth={2.25} dot={false} />
          <Line type="monotone" dataKey="netPlotManwon" name="순현금흐름" stroke={LINE_COLORS.net} strokeWidth={3} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
