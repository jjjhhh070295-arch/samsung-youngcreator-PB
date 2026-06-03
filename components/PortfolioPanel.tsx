"use client";

// ★팀원 인계 영역 — 포트폴리오 후보 3개 (더미 스캐폴드)
// 화면·저장·PB 수정 UI는 동작. 산출 숫자는 lib/portfolio.ts 더미.

import { useState } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from "recharts";
import type { Client, Portfolio } from "@/lib/types";
import { generatePortfolios, weightSum } from "@/lib/portfolio";
import { CHART_COLORS } from "@/lib/theme";
import { EmptyView } from "./StateViews";

interface Props {
  client: Client;
  onSave: (portfolios: Portfolio[]) => Promise<void> | void;
}

const PIE_COLORS = [
  CHART_COLORS.series[0],
  CHART_COLORS.series[1],
  CHART_COLORS.series[2],
  CHART_COLORS.series[3],
  CHART_COLORS.series[5],
];

export default function PortfolioPanel({ client, onSave }: Props) {
  const [portfolios, setPortfolios] = useState<Portfolio[]>(client.portfolios ?? []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const generate = () => {
    // TODO(팀원): generatePortfolios 를 실제 최적화 로직으로 교체
    setPortfolios(generatePortfolios(client));
    setDirty(true);
  };

  const updateWeight = (pfId: string, idx: number, weight: number) => {
    setPortfolios((prev) =>
      prev.map((p) =>
        p.id === pfId
          ? {
              ...p,
              editedByPb: true,
              allocations: p.allocations.map((a, i) =>
                i === idx ? { ...a, weight } : a,
              ),
            }
          : p,
      ),
    );
    setDirty(true);
  };

  const updateTaxNote = (pfId: string, taxNote: string) => {
    setPortfolios((prev) =>
      prev.map((p) => (p.id === pfId ? { ...p, taxNote, editedByPb: true } : p)),
    );
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      await onSave(portfolios);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <button className="btn-gold text-sm" onClick={generate}>
          포트폴리오 생성 (더미)
        </button>
        {portfolios.length > 0 && (
          <button className="btn-outline text-sm" onClick={save} disabled={!dirty || saving}>
            {saving ? "저장 중…" : dirty ? "포트폴리오 저장" : "저장됨"}
          </button>
        )}
      </div>

      {portfolios.length === 0 ? (
        <EmptyView
          title="아직 생성된 포트폴리오가 없어요"
          hint="[포트폴리오 생성]을 누르면 안정형/균형형/성장형 후보 3개가 만들어집니다. (현재 산출값은 더미)"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {portfolios.map((p) => {
            const sum = weightSum(p);
            const sumOk = Math.abs(sum - 100) < 0.05;
            const pieData = p.allocations.map((a) => ({
              name: a.assetClass,
              value: a.weight,
            }));
            return (
              <div key={p.id} className="card p-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-fg">{p.label}</h3>
                  {p.editedByPb && <span className="badge-gold">PB 수정</span>}
                </div>

                <ResponsiveContainer width="100%" height={160}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={60}
                      innerRadius={30}
                    >
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => `${v}%`}
                      contentStyle={{
                        background: "rgb(var(--surface))",
                        border: "1px solid rgb(var(--border))",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>

                {/* 자산배분 비중 (PB 수정) */}
                <div className="mt-2 space-y-1.5">
                  {p.allocations.map((a, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                      />
                      <span className="flex-1 text-xs text-fg">{a.assetClass}</span>
                      <input
                        type="number"
                        className="input h-7 w-16 px-2 py-0 text-right text-xs"
                        value={a.weight}
                        onChange={(e) =>
                          updateWeight(p.id, i, Number(e.target.value) || 0)
                        }
                      />
                      <span className="text-xs text-fg-muted">%</span>
                    </div>
                  ))}
                </div>

                <p
                  className={`mt-1 text-right text-xs ${
                    sumOk ? "text-fg-muted" : "text-red-500"
                  }`}
                >
                  합계 {sum}% {sumOk ? "✓" : "(100 아님)"}
                </p>

                <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-lg bg-surface-2 p-2">
                    <p className="text-[11px] text-fg-muted">예상 수익률</p>
                    <p className="text-sm font-semibold text-gold-600 dark:text-gold-300">
                      {p.expectedReturn}%
                    </p>
                  </div>
                  <div className="rounded-lg bg-surface-2 p-2">
                    <p className="text-[11px] text-fg-muted">예상 변동성</p>
                    <p className="text-sm font-semibold text-fg">{p.expectedRisk}%</p>
                  </div>
                </div>

                <div className="mt-3">
                  <label className="label">세금 고려 메모</label>
                  <textarea
                    className="input min-h-[48px] resize-y text-xs"
                    value={p.taxNote}
                    onChange={(e) => updateTaxNote(p.id, e.target.value)}
                  />
                </div>

                <p className="mt-2 text-[11px] italic text-fg-muted">{p.rationale}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
