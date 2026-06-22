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

const signedValues = (point: PeriodCashflowChartPoint) => [
  point.incomeSignedManwon,
  point.outflowSignedManwon,
  point.savingSignedManwon,
  point.taxSignedManwon,
  point.netSignedManwon,
];

const computeSignedDomain = (chartData: PeriodCashflowChartPoint[]): [number, number] => {
  const values = chartData.flatMap(signedValues);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || Math.max(Math.abs(max), Math.abs(min), 1);
  const padding = Math.max(1, Math.ceil(span * 0.1));
  return [Math.floor(min - padding), Math.ceil(max + padding)];
};

export default function PeriodCashflowLineChart({
  series,
  className = "h-[270px]",
}: {
  series: PeriodCashflowPoint[];
  className?: string;
}) {
  const chartData = toPeriodCashflowChartData(series);
  const yDomain = computeSignedDomain(chartData);

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
          <ReferenceLine y={0} stroke="#111827" strokeWidth={1.5} ifOverflow="extendDomain" />
          <Tooltip formatter={(value: unknown) => `${Number(value).toLocaleString()}만원`} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
          <Line type="monotone" dataKey="incomeSignedManwon" name="유입" stroke={LINE_COLORS.income} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="outflowSignedManwon" name="유출" stroke={LINE_COLORS.outflow} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="savingSignedManwon" name="저축/투자" stroke={LINE_COLORS.saving} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="taxSignedManwon" name="세금" stroke={LINE_COLORS.tax} strokeWidth={2.25} dot={false} />
          <Line type="monotone" dataKey="netSignedManwon" name="순현금흐름" stroke={LINE_COLORS.net} strokeWidth={3} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
