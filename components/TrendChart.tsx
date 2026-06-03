"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useState } from "react";
import type { Consultation, FactorKey } from "@/lib/types";
import { FACTOR_META } from "@/lib/types";
import { CHART_COLORS } from "@/lib/theme";
import { formatDate } from "@/lib/format";
import { EmptyView } from "./StateViews";

interface Props {
  consultations: Consultation[];
}

// 성향 변화 시계열.
// ★ 검토 확정(reviewed)된 explicit 점수만 반영해 추세 오염을 막는다.
export default function TrendChart({ consultations }: Props) {
  const [hidden, setHidden] = useState<Set<FactorKey>>(new Set());

  const sorted = consultations
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));

  const data = sorted.map((c) => {
    const row: Record<string, any> = { date: formatDate(c.createdAt) };
    for (const m of FACTOR_META) {
      const f = c.ipsSnapshot?.[m.key];
      // 검토 확정 + explicit + 점수 존재할 때만
      row[m.key] =
        f && f.reviewed && f.status === "explicit" && f.score != null ? f.score : null;
    }
    return row;
  });

  const hasAny = data.some((row) =>
    FACTOR_META.some((m) => row[m.key] != null),
  );

  if (sorted.length === 0) {
    return (
      <EmptyView
        title="상담 이력이 없어요"
        hint="상담을 종료하면 그 시점의 7요인 스냅샷이 여기 시계열로 쌓입니다."
      />
    );
  }
  if (!hasAny) {
    return (
      <EmptyView
        title="아직 확정된 점수가 없어요"
        hint="검토 확정(reviewed)된 명시적 점수만 추세에 반영됩니다. 요인을 검토 확정해 보세요."
      />
    );
  }

  const toggle = (key: FactorKey) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div>
      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.muted} strokeOpacity={0.25} />
          <XAxis dataKey="date" tick={{ fill: "currentColor", fontSize: 11 }} />
          <YAxis domain={[0, 5]} ticks={[1, 2, 3, 4, 5]} tick={{ fill: "currentColor", fontSize: 11 }} />
          <Tooltip
            contentStyle={{
              background: "rgb(var(--surface))",
              border: "1px solid rgb(var(--border))",
              borderRadius: 8,
              fontSize: 12,
              color: "rgb(var(--fg))",
            }}
          />
          {FACTOR_META.map((m, i) =>
            hidden.has(m.key) ? null : (
              <Line
                key={m.key}
                type="monotone"
                dataKey={m.key}
                name={m.label}
                stroke={CHART_COLORS.series[i]}
                strokeWidth={2}
                connectNulls
                dot={{ r: 3 }}
                activeDot={{ r: 5 }}
              />
            ),
          )}
        </LineChart>
      </ResponsiveContainer>

      {/* 요인 토글 범례 */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {FACTOR_META.map((m, i) => {
          const off = hidden.has(m.key);
          return (
            <button
              key={m.key}
              onClick={() => toggle(m.key)}
              className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-opacity ${
                off ? "opacity-40" : "opacity-100"
              }`}
              style={{ borderColor: CHART_COLORS.series[i] }}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: CHART_COLORS.series[i] }}
              />
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
