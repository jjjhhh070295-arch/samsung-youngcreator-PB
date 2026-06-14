"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
} from "recharts";
import type { IPS } from "@/lib/types";
import { FACTOR_META } from "@/lib/types";
import { CHART_COLORS } from "@/lib/theme";

interface Props {
  ips: IPS;
  height?: number;
  lang?: "ko" | "en";
}

// 현재 7요인 점수를 가로 막대 그래프로.
// 공백·추론 요인은 0(막대 없음)으로 두고, 아래에 "미확정" 안내를 표시한다.
export default function IPSRadar({ ips, height = 280, lang = "ko" }: Props) {
  const data = FACTOR_META.map((m) => {
    const factor = ips[m.key];
    const hasScore = factor.status === "explicit" && factor.score != null;
    return {
      factor: lang === "en" ? m.labelEn : m.label,
      score: hasScore ? (factor.score as number) : 0,
      confirmed: hasScore,
    };
  });

  const unconfirmed = data.filter((d) => !d.confirmed).map((d) => d.factor);

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 28, bottom: 4, left: 8 }}
          barCategoryGap="22%"
        >
          <CartesianGrid horizontal={false} stroke={CHART_COLORS.muted} strokeOpacity={0.25} />
          <XAxis
            type="number"
            domain={[0, 5]}
            ticks={[0, 1, 2, 3, 4, 5]}
            tick={{ fill: "currentColor", fontSize: 11 }}
            axisLine={{ stroke: CHART_COLORS.muted, strokeOpacity: 0.4 }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="factor"
            width={84}
            tick={{ fill: "currentColor", fontSize: 12, fontWeight: 600 }}
            axisLine={false}
            tickLine={false}
          />
          <Bar dataKey="score" radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell
                key={i}
                fill={CHART_COLORS.accent}
                fillOpacity={d.confirmed ? 0.85 : 0.2}
              />
            ))}
            <LabelList
              dataKey="score"
              position="right"
              formatter={(v: number) => (v > 0 ? v : "—")}
              style={{ fill: "currentColor", fontSize: 11, fontWeight: 700 }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {unconfirmed.length > 0 && (
        <p className="mt-1 text-center text-xs text-fg-muted">
          {lang === "en" ? "Not scored: " : "미확정(점수 없음): "}
          {unconfirmed.join(", ")}
        </p>
      )}
    </div>
  );
}
