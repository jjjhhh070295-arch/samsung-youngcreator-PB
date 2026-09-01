"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { EnrichedBar } from "@/lib/advisory/tickerIndicatorsExtended";
import type { IndicatorSlot } from "@/lib/advisory/tickerIndicatorConfig";
import type { FinancialSnapshot } from "@/lib/advisory/ohlcTypes";

const COLORS = {
  macd: "#2563eb",
  signal: "#f97316",
  positive: "#ef4444",
  negative: "#2563eb",
  rsi: "#7c3aed",
};

function fmt(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString("ko-KR", { maximumFractionDigits: 4 }) : "—";
}

export function TickerIndicatorPanels({
  slots,
  bars,
  syncId,
  financial,
  investorNote,
  investorBars,
}: {
  slots: IndicatorSlot[];
  bars: EnrichedBar[];
  syncId: string;
  financial: FinancialSnapshot | null;
  investorNote?: string;
  investorBars: Array<{ time: string; foreignNet: number; institutionNet: number; individualNet: number }>;
}) {
  const chartData = bars.map((b) => ({ ...b, t: b.time.slice(5) }));

  return (
    <div className="space-y-0 border-t border-border">
      {slots.map((slot) => {
        if (slot.kind === "rsi") {
          return (
            <Panel key={slot.id} title={slot.displayName} subtitle="RSI(14) · 70/30">
              <ResponsiveContainer width="100%" height={140}>
                <LineChart data={chartData} syncId={syncId}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="t" tick={{ fontSize: 10 }} />
                  <YAxis domain={[0, 100]} ticks={[30, 50, 70]} width={40} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => fmt(v)} />
                  <ReferenceArea y1={70} y2={100} fill="#ef4444" fillOpacity={0.05} />
                  <ReferenceArea y1={0} y2={30} fill="#2563eb" fillOpacity={0.05} />
                  <Line dataKey="rsi14" stroke={COLORS.rsi} dot={false} strokeWidth={1.5} connectNulls isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </Panel>
          );
        }
        if (slot.kind === "macd") {
          return (
            <Panel key={slot.id} title={slot.displayName} subtitle="MACD(12,26,9)">
              <ResponsiveContainer width="100%" height={140}>
                <ComposedChart data={chartData} syncId={syncId}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="t" tick={{ fontSize: 10 }} />
                  <YAxis width={40} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => fmt(v)} />
                  <ReferenceLine y={0} stroke="#94a3b8" />
                  <Bar dataKey="macdHistogram">
                    {chartData.map((entry, i) => (
                      <Cell key={i} fill={(entry.macdHistogram ?? 0) >= 0 ? COLORS.positive : COLORS.negative} fillOpacity={0.65} />
                    ))}
                  </Bar>
                  <Line dataKey="macd" stroke={COLORS.macd} dot={false} strokeWidth={1.2} connectNulls isAnimationActive={false} />
                  <Line dataKey="macdSignal" stroke={COLORS.signal} dot={false} strokeWidth={1.2} connectNulls isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </Panel>
          );
        }
        if (slot.kind === "volume") {
          return (
            <Panel key={slot.id} title={slot.displayName} subtitle="일별 거래량">
              <ResponsiveContainer width="100%" height={120}>
                <BarChart data={chartData} syncId={syncId}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="t" tick={{ fontSize: 10 }} />
                  <YAxis width={48} tick={{ fontSize: 10 }} tickFormatter={(v) => fmt(v)} />
                  <Tooltip formatter={(v) => fmt(v)} />
                  <Bar dataKey="volume" fill="#1428A0" fillOpacity={0.55} />
                </BarChart>
              </ResponsiveContainer>
            </Panel>
          );
        }
        if (slot.kind === "supply_demand") {
          const invData = investorBars.map((b) => ({ ...b, t: b.time.slice(5) }));
          return (
            <Panel key={slot.id} title={slot.displayName} subtitle="투자자별 순매수">
              {invData.length ? (
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart data={invData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="t" tick={{ fontSize: 10 }} />
                    <YAxis width={48} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v) => fmt(v)} />
                    <Bar dataKey="foreignNet" name="외국인" fill="#2563eb" stackId="a" />
                    <Bar dataKey="institutionNet" name="기관" fill="#1428A0" stackId="a" />
                    <Bar dataKey="individualNet" name="개인" fill="#94a3b8" stackId="a" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="px-3 py-4 text-xs text-amber-800">{investorNote ?? "수급 데이터 env/API 미연결"}</p>
              )}
            </Panel>
          );
        }
        if (slot.kind === "net_income" || slot.kind === "revenue_growth") {
          const val =
            slot.kind === "net_income"
              ? financial?.netIncome
              : financial?.revenueGrowthPct;
          const label = slot.kind === "net_income" ? "당기순이익" : "매출증가량(YoY)";
          return (
            <Panel key={slot.id} title={slot.displayName} subtitle={label}>
              <div className="px-3 py-3">
                <p className="text-2xl font-bold text-fg">
                  {val == null
                    ? "—"
                    : slot.kind === "revenue_growth"
                      ? `${val.toFixed(2)}%`
                      : val.toLocaleString("ko-KR")}
                </p>
                <p className="mt-1 text-[10px] text-fg-muted">
                  {financial
                    ? `as-of ${financial.asOf.slice(0, 10)} · ${financial.source}${financial.currency ? ` · ${financial.currency}` : ""}`
                    : "재무 데이터 미연결"}
                </p>
              </div>
            </Panel>
          );
        }
        return null;
      })}
    </div>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border bg-surface">
      <div className="px-3 py-2">
        <p className="text-xs font-bold text-fg">{title}</p>
        <p className="text-[10px] text-fg-muted">{subtitle}</p>
      </div>
      <div className="px-1 pb-2">{children}</div>
    </div>
  );
}
