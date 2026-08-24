"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
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
  net: "#0f172a",
} as const;

const plottedValues = (point: PeriodCashflowChartPoint) => [
  point.incomePlotManwon,
  point.nonTaxOutflowPlotManwon,
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
        <ComposedChart data={chartData} margin={{ top: 8, right: 14, bottom: 0, left: -10 }}>
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
          <Bar dataKey="incomePlotManwon" name="순유입" fill={LINE_COLORS.income} radius={[4, 4, 0, 0]} />
          <Bar dataKey="nonTaxOutflowPlotManwon" name="순유출(세금 제외)" fill={LINE_COLORS.outflow} radius={[4, 4, 0, 0]} />
          <Bar dataKey="taxPlotManwon" name="총세금" fill={LINE_COLORS.tax} radius={[4, 4, 0, 0]} />
          <Line type="monotone" dataKey="netPlotManwon" name="월 순자금" stroke={LINE_COLORS.net} strokeWidth={3} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
