"use client";

// ★팀원 인계 영역 — 스트레스 테스트 (더미 스캐폴드)

import { useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { Portfolio, StressScenario, StressTestResult } from "@/lib/types";
import { DEFAULT_SCENARIOS, runStressTest } from "@/lib/stresstest";
import { CHART_COLORS } from "@/lib/theme";
import { EmptyView } from "./StateViews";

interface Props {
  portfolios: Portfolio[];
}

export default function StressTestPanel({ portfolios }: Props) {
  const [scenarioId, setScenarioId] = useState<string>(DEFAULT_SCENARIOS[0].id);
  const [results, setResults] = useState<StressTestResult[] | null>(null);

  const scenario: StressScenario =
    DEFAULT_SCENARIOS.find((s) => s.id === scenarioId) ?? DEFAULT_SCENARIOS[0];

  const run = () => {
    // TODO(팀원): runStressTest 를 실제 검정 로직으로 교체
    setResults(runStressTest(portfolios, scenario));
  };

  const labelOf = (pfId: string) =>
    portfolios.find((p) => p.id === pfId)?.label ?? pfId;

  if (portfolios.length === 0) {
    return (
      <EmptyView
        title="포트폴리오를 먼저 생성하세요"
        hint="스트레스 테스트는 생성된 포트폴리오 후보를 대상으로 실행합니다."
      />
    );
  }

  const chartData =
    results?.map((r) => ({
      name: labelOf(r.portfolioId),
      "예상수익(%)": r.projectedReturn,
      "최대낙폭(%)": r.projectedDrawdown,
    })) ?? [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select
          className="input h-9 w-auto"
          value={scenarioId}
          onChange={(e) => setScenarioId(e.target.value)}
        >
          {DEFAULT_SCENARIOS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <button className="btn-gold text-sm" onClick={run}>
          스트레스 실행 (더미)
        </button>
      </div>

      {!results ? (
        <EmptyView
          title="시나리오를 선택하고 실행하세요"
          hint="금리·주가·인플레 등 시나리오별 예상수익·최대낙폭을 더미로 보여줍니다."
        />
      ) : (
        <>
          <div className="card p-4">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.muted} strokeOpacity={0.25} />
                <XAxis dataKey="name" tick={{ fill: "currentColor", fontSize: 12 }} />
                <YAxis tick={{ fill: "currentColor", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{
                    background: "rgb(var(--surface))",
                    border: "1px solid rgb(var(--border))",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="예상수익(%)" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
                <Bar dataKey="최대낙폭(%)" fill={CHART_COLORS.accent} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-2 text-xs text-fg-muted">
                <tr>
                  <th className="px-3 py-2 text-left">포트폴리오</th>
                  <th className="px-3 py-2 text-right">예상 수익 (%)</th>
                  <th className="px-3 py-2 text-right">최대 낙폭 (%)</th>
                  <th className="px-3 py-2 text-left">비고</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.portfolioId} className="border-b border-border/60 last:border-0">
                    <td className="px-3 py-2 font-medium text-fg">{labelOf(r.portfolioId)}</td>
                    <td className="px-3 py-2 text-right text-gold-600 dark:text-gold-300">
                      {r.projectedReturn}
                    </td>
                    <td className="px-3 py-2 text-right text-red-500">-{r.projectedDrawdown}</td>
                    <td className="px-3 py-2 text-xs text-fg-muted">{r.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
