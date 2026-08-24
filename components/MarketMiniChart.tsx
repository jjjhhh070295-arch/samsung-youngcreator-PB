"use client";

import { useEffect, useState } from "react";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from "recharts";

interface DataPoint { time: string; value: number }

interface Props {
  data: DataPoint[];
  prevClose: number | null;
  label: string;
  loading: boolean;
  delayMinutes?: number;
  startTime?: string | null;
  endTime?: string | null;
}

export default function MarketMiniChart({ data, prevClose, label, loading, delayMinutes = 0, startTime, endTime }: Props) {
  const latest = data.length > 0 ? data[data.length - 1].value : null;
  const base = prevClose ?? (data.length > 0 ? data[0].value : null);
  const isUp = latest != null && base != null ? latest >= base : true;
  const color = isUp ? "#16a34a" : "#dc2626";
  const change = latest != null && base != null ? ((latest - base) / base) * 100 : null;

  const minVal = data.length > 0 ? Math.min(...data.map((d) => d.value)) : 0;
  const maxVal = data.length > 0 ? Math.max(...data.map((d) => d.value)) : 0;
  const padding = (maxVal - minVal) * 0.1 || 1;

  return (
    <div className="rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div className="mb-1 flex items-center justify-between">
        <p className="text-xs font-semibold text-fg-muted">{label}</p>
        <div className="flex items-center gap-2">
          {startTime && endTime && (
            <span className="text-[10px] text-fg-muted/70">{startTime} ~ {endTime}</span>
          )}
          {delayMinutes > 0 && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
              {delayMinutes}분 지연
            </span>
          )}
          {change != null && (
            <span className={`text-xs font-bold ${isUp ? "text-green-600" : "text-red-500"}`}>
              {isUp ? "+" : ""}{change.toFixed(2)}%
            </span>
          )}
        </div>
      </div>
      {latest != null && (
        <p className="mb-2 text-lg font-black text-fg">
          {latest.toLocaleString("ko-KR", { maximumFractionDigits: 2 })}
        </p>
      )}
      {loading || data.length === 0 ? (
        <div className="flex h-[130px] items-center justify-center text-xs text-fg-muted">
          {loading ? "불러오는 중…" : "데이터 없음"}
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={130}>
          <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={`grad-${label}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                <stop offset="95%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis dataKey="time" hide />
            <YAxis domain={[minVal - padding, maxVal + padding]} hide />
            <Tooltip
              contentStyle={{ fontSize: 11, padding: "4px 8px", borderRadius: 6 }}
              formatter={(v: number) => [v.toLocaleString("ko-KR", { maximumFractionDigits: 2 }), label]}
              labelStyle={{ fontSize: 10 }}
            />
            <Area
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              fill={`url(#grad-${label})`}
              dot={false}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
