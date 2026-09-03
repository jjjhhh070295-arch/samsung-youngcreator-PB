"use client";

import { useEffect, useMemo, useState } from "react";
import type { CashFlow } from "@/lib/types";
import { formatKRW, parseNumber } from "@/lib/format";
import PeriodCashflowLineChart from "./cashflow/PeriodCashflowLineChart";
import {
  calcSimpleNetCash,
  loadSimpleCashflowRows,
  nextSimpleCashflowPeriod,
  rowsToPeriodSeries,
  simpleRowsToCashFlows,
  summarizeSimpleCashflowRows,
  type SimpleCashflowRow,
} from "@/lib/simpleCashflow";

interface Props {
  cashFlows: CashFlow[];
  onSave: (flows: CashFlow[]) => Promise<void> | void;
  pbId?: string;
  clientId?: string;
}

function detailOpenKey(pbId: string, clientId: string) {
  return `pb-cashflow-detail-open:${pbId || "default"}:${clientId || "default"}`;
}

function loadDetailOpen(pbId: string, clientId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(detailOpenKey(pbId, clientId)) === "1";
  } catch {
    return false;
  }
}

function saveDetailOpen(pbId: string, clientId: string, open: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(detailOpenKey(pbId, clientId), open ? "1" : "0");
  } catch {
    // ignore quota / private mode
  }
}

function SummaryCard({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="console-metric">
      <p className="console-label">{label}</p>
      <p className={`mt-1 text-sm font-bold ${tone ?? "text-fg"}`}>{formatKRW(value)}</p>
    </div>
  );
}

export default function SimpleCashflowPanel({ cashFlows, onSave, pbId = "default", clientId = "default" }: Props) {
  const [rows, setRows] = useState<SimpleCashflowRow[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    setRows(loadSimpleCashflowRows(cashFlows));
    setDirty(false);
  }, [cashFlows]);

  useEffect(() => {
    setDetailOpen(loadDetailOpen(pbId, clientId));
  }, [pbId, clientId]);

  const totals = useMemo(() => summarizeSimpleCashflowRows(rows), [rows]);
  const chartSeries = useMemo(() => rowsToPeriodSeries(rows), [rows]);

  const mutate = (next: SimpleCashflowRow[]) => {
    setRows(next);
    setDirty(true);
  };

  const updateRow = (id: string, patch: Partial<SimpleCashflowRow>) => {
    mutate(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const addRow = () => {
    mutate([
      ...rows,
      {
        id: `row-${Date.now()}`,
        period: nextSimpleCashflowPeriod(rows),
        netInflow: 0,
        netOutflowExTax: 0,
        totalTax: 0,
      },
    ]);
  };

  const removeRow = (id: string) => {
    mutate(rows.filter((row) => row.id !== id));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(simpleRowsToCashFlows(rows, cashFlows));
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const toggleDetail = () => {
    setDetailOpen((prev) => {
      const next = !prev;
      saveDetailOpen(pbId, clientId, next);
      return next;
    });
  };

  return (
    <div className="card p-4">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-fg">현금흐름</h3>
          <p className="mt-0.5 text-[11px] text-fg-muted">
            순유입, 순유출, 총세금만 입력해 월별 현금흐름을 관리합니다.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-outline text-xs" onClick={toggleDetail}>
            {detailOpen ? "접기" : "상세보기"}
          </button>
          <button type="button" className="btn-primary text-xs" onClick={handleSave} disabled={saving || !dirty}>
            {saving ? "저장 중…" : dirty ? "저장" : "저장됨"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <SummaryCard label="표시기간 순유입 합계" value={totals.netInflow} tone="text-[#1428A0]" />
        <SummaryCard label="표시기간 순유출 합계(세금 제외)" value={totals.netOutflowExTax} />
        <SummaryCard label="표시기간 총세금" value={totals.totalTax} />
        <SummaryCard
          label="표시기간 순자금"
          value={totals.netCash}
          tone={totals.netCash >= 0 ? "text-[#1428A0]" : "text-red-600"}
        />
      </div>

      {detailOpen ? (
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-fg-muted">월별 입력 · 차트</p>
            <button type="button" className="btn-outline text-xs" onClick={addRow}>
              + 월 추가
            </button>
          </div>

          {rows.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-surface-2/40 px-4 py-10 text-center text-sm text-fg-muted">
              등록된 월별 현금흐름이 없습니다. &quot;+ 월 추가&quot;로 첫 행을 만드세요.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="min-w-full border-collapse text-left text-xs">
                <thead className="bg-surface-2 text-fg-muted">
                  <tr>
                    <th className="px-3 py-2 font-bold">월 / 기간</th>
                    <th className="px-3 py-2 font-bold">순유입</th>
                    <th className="px-3 py-2 font-bold">순유출</th>
                    <th className="px-3 py-2 font-bold">총세금</th>
                    <th className="px-3 py-2 font-bold">순자금</th>
                    <th className="px-3 py-2 font-bold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-white">
                  {[...rows]
                    .sort((a, b) => a.period.localeCompare(b.period))
                    .map((row) => (
                      <tr key={row.id}>
                        <td className="px-3 py-2">
                          <input
                            className="input py-1 text-xs"
                            type="month"
                            value={row.period}
                            onChange={(e) => updateRow(row.id, { period: e.target.value })}
                          />
                        </td>
                        {(["netInflow", "netOutflowExTax", "totalTax"] as const).map((field) => (
                          <td key={field} className="px-3 py-2">
                            <input
                              className="input py-1 text-xs"
                              inputMode="numeric"
                              value={row[field] ? String(row[field]) : ""}
                              placeholder="0"
                              onChange={(e) =>
                                updateRow(row.id, { [field]: Math.max(0, parseNumber(e.target.value)) })
                              }
                            />
                          </td>
                        ))}
                        <td className="px-3 py-2 font-semibold text-[#1428A0]">
                          {formatKRW(calcSimpleNetCash(row))}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <button
                            type="button"
                            className="btn-ghost px-2 py-1 text-[11px] text-red-500"
                            onClick={() => removeRow(row.id)}
                          >
                            삭제
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}

          {chartSeries.length > 0 ? (
            <div className="rounded-xl border border-border bg-surface-2/30 p-3">
              <p className="mb-2 text-xs font-bold text-fg">월별 현금흐름 추이</p>
              <PeriodCashflowLineChart series={chartSeries} className="h-72" />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
