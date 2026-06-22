"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PeriodCashflowPoint } from "@/lib/periodCashflow";
import { toPeriodCashflowChartData } from "@/lib/periodCashflow";

export const LINE_COLORS = {
  income: "#2563eb",
  tax: "#8b5cf6",
  outflow: "#ef4444",
  saving: "#f59e0b",
  net: "#0f172a",
} as const;

export default function PeriodCashflowLineChart({
  series,
  className = "h-[270px]",
}: {
  series: PeriodCashflowPoint[];
  className?: string;
}) {
  const chartData = toPeriodCashflowChartData(series);

  return (
    <div className={className}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 8, right: 14, bottom: 0, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.35)" />
          <XAxis dataKey="period" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} tickFormatter={(value) => `${Number(value).toLocaleString()}만`} />
          <Tooltip formatter={(value: unknown) => `${Number(value).toLocaleString()}만원`} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
          <Line type="monotone" dataKey="incomeManwon" name="유입" stroke={LINE_COLORS.income} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="outflowManwon" name="유출" stroke={LINE_COLORS.outflow} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="savingManwon" name="저축/투자" stroke={LINE_COLORS.saving} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="taxManwon" name="세금" stroke={LINE_COLORS.tax} strokeWidth={2.25} dot={false} />
          <Line type="monotone" dataKey="netManwon" name="순현금흐름" stroke={LINE_COLORS.net} strokeWidth={3} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
