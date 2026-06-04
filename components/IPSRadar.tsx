"use client";

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
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

// 현재 7요인 점수를 거미줄(레이더) 그래프로.
// 공백·추론 요인은 0으로 두고, 아래에 "미확정" 안내를 표시한다.
export default function IPSRadar({ ips, height = 280, lang = "ko" }: Props) {
  const data = FACTOR_META.map((m) => {
    const factor = ips[m.key];
    const hasScore = factor.status === "explicit" && factor.score != null;
    return {
      factor: lang === "en" ? m.labelEn : m.label,
      score: hasScore ? factor.score : 0,
      confirmed: hasScore,
    };
  });

  const unconfirmed = data.filter((d) => !d.confirmed).map((d) => d.factor);

  return (
    <div>
      <ResponsiveContainer width="100%" height={height}>
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke={CHART_COLORS.muted} strokeOpacity={0.4} />
          <PolarAngleAxis
            dataKey="factor"
            tick={{ fill: "currentColor", fontSize: 12, fontWeight: 600 }}
          />
          <PolarRadiusAxis
            domain={[0, 5]}
            tickCount={6}
            tick={false}
            axisLine={false}
            tickLine={false}
          />
          <Radar
            name="점수"
            dataKey="score"
            stroke={CHART_COLORS.accent}
            fill={CHART_COLORS.accent}
            fillOpacity={0.35}
            strokeWidth={2}
          />
        </RadarChart>
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
