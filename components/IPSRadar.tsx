"use client";

/**
 * ⚠️ 현재 어디에서도 쓰이지 않는다 (2026-09-10 부로 호출부 4곳 모두 제거).
 *
 * 이름은 Radar 지만 실제로는 7요인 점수를 가로막대(BarChart, layout="vertical")로 그린다.
 * 쓰이던 곳:
 *   FactorsSummary        기본 정보 → 7요인, "고객 투자성향 요약 / RRTTLLU profile"
 *   ClientFacingViewBody  고객화면 → 투자 목적·성향 (PB 탭 + 공유 링크)
 *   ConsultationModal     상담 입력 → ② RRTTLLU 7요인 정리
 *   IPSResultTabs         IPS 탭 → IPS 초안 미리보기
 *
 * 지우지 않고 남긴 이유: 되살릴 여지가 있고, 파일은 자족적이라(recharts + 타입만 의존)
 * 남겨도 비용이 없다. 참조가 없으므로 어떤 번들에도 포함되지 않는다.
 * 되살릴 때는 위 네 곳의 레이아웃도 함께 되돌려야 한다 — 차트를 빼면서 감싸던
 * 2열 그리드와 테두리 상자를 정리했다.
 */

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
import { derivePropensity } from "@/lib/rrttlluScoring";

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

  // 성향등급(안정형~공격투자형) — 목표수익률·위험허용도 점수 기반
  const propensity = derivePropensity(
    ips.return.status === "explicit" ? ips.return.score : null,
    ips.risk.status === "explicit" ? ips.risk.score : null,
  );

  return (
    <div>
      {propensity && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-fg-muted">{lang === "en" ? "Profile" : "투자성향"}</span>
          <span className="rounded-md bg-gold-400/15 px-2.5 py-1 text-sm font-bold text-gold-600 dark:text-gold-300">
            {propensity.label} ({propensity.grade}/5)
          </span>
          {propensity.returnMismatch && (
            <span className="rounded-md bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-500">
              ⚠ 목표수익률이 위험성향보다 높음 (정합성 점검)
            </span>
          )}
        </div>
      )}
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
