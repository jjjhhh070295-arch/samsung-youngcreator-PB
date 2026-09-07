"use client";

import { useEffect, useMemo, useState } from "react";
import type { CashFlow } from "@/lib/types";
import { formatKRW, parseNumber } from "@/lib/format";
import PeriodCashflowLineChart from "./cashflow/PeriodCashflowLineChart";
import {
  CASHFLOW_PERIOD_TYPE_OPTIONS,
  compareCashflowPeriodKeys,
  formatCashflowPeriodLabel,
  isCashflowPeriodType,
  type CashflowPeriodType,
} from "@/lib/cashflowPeriod";
import {
  calcSimpleNetCash,
  inferCashflowPeriodType,
  loadSimpleCashflowRows,
  nextSimpleCashflowPeriod,
  rowsToPeriodSeries,
  simpleRowsToCashFlows,
  summarizeSimpleCashflowRows,
  type SimpleCashflowRow,
} from "@/lib/simpleCashflow";

interface Props {
  cashFlows: CashFlow[];
  onSave: (flows: CashFlow[], periodType?: CashflowPeriodType) => Promise<void> | void;
  pbId?: string;
  clientId?: string;
  /** 고객에 저장된 입력 주기(있으면 우선) */
  initialPeriodType?: CashflowPeriodType | null;
}

function detailOpenKey(pbId: string, clientId: string) {
  return `pb-cashflow-detail-open:${pbId || "default"}:${clientId || "default"}`;
}

function periodTypeKey(pbId: string, clientId: string) {
  return `pb-cashflow-period-type:${pbId || "default"}:${clientId || "default"}`;
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

function loadStoredPeriodType(pbId: string, clientId: string): CashflowPeriodType | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(periodTypeKey(pbId, clientId));
    return isCashflowPeriodType(raw) ? raw : null;
  } catch {
    return null;
  }
}

function saveStoredPeriodType(pbId: string, clientId: string, periodType: CashflowPeriodType) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(periodTypeKey(pbId, clientId), periodType);
  } catch {
    // ignore
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

function PeriodEditor({
  periodType,
  value,
  onChange,
}: {
  periodType: CashflowPeriodType;
  value: string;
  onChange: (next: string) => void;
}) {
  if (periodType === "monthly") {
    return (
      <input
        className="input py-1 text-xs"
        type="month"
        value={/^\d{4}-\d{2}$/.test(value) ? value : ""}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  const year = value.match(/^(20\d{2})/)?.[1] ?? String(new Date().getFullYear());
  const setYear = (nextYear: string) => {
    if (periodType === "yearly") onChange(nextYear);
    else if (periodType === "quarterly") {
      const q = value.match(/-Q([1-4])/)?.[1] ?? "1";
      onChange(`${nextYear}-Q${q}`);
    } else {
      const h = value.match(/-H([12])/)?.[1] ?? "1";
      onChange(`${nextYear}-H${h}`);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      <input
        className="input w-20 py-1 text-xs"
        type="number"
        min={2000}
        max={2100}
        value={year}
        onChange={(e) => setYear(e.target.value.slice(0, 4))}
      />
      <span className="text-[11px] text-fg-muted">년</span>
      {periodType === "quarterly" && (
        <select
          className="input py-1 text-xs"
          value={value.match(/-Q([1-4])/)?.[1] ?? "1"}
          onChange={(e) => onChange(`${year}-Q${e.target.value}`)}
        >
          <option value="1">1분기</option>
          <option value="2">2분기</option>
          <option value="3">3분기</option>
          <option value="4">4분기</option>
        </select>
      )}
      {periodType === "semiAnnual" && (
        <select
          className="input py-1 text-xs"
          value={value.match(/-H([12])/)?.[1] ?? "1"}
          onChange={(e) => onChange(`${year}-H${e.target.value}`)}
        >
          <option value="1">상반기</option>
          <option value="2">하반기</option>
        </select>
      )}
    </div>
  );
}

export default function SimpleCashflowPanel({
  cashFlows,
  onSave,
  pbId = "default",
  clientId = "default",
  initialPeriodType = null,
}: Props) {
  const [rows, setRows] = useState<SimpleCashflowRow[]>([]);
  const [periodType, setPeriodType] = useState<CashflowPeriodType>("monthly");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  useEffect(() => {
    setRows(loadSimpleCashflowRows(cashFlows));
    const inferred = inferCashflowPeriodType(cashFlows);
    const stored = loadStoredPeriodType(pbId, clientId);
    const nextType = initialPeriodType ?? stored ?? inferred;
    setPeriodType(nextType);
    setDirty(false);
  }, [cashFlows, clientId, initialPeriodType, pbId]);

  useEffect(() => {
    setDetailOpen(loadDetailOpen(pbId, clientId));
  }, [pbId, clientId]);

  const totals = useMemo(() => summarizeSimpleCashflowRows(rows), [rows]);
  const chartSeries = useMemo(() => rowsToPeriodSeries(rows), [rows]);
  const sortedRows = useMemo(
    () => [...rows].sort((a, b) => compareCashflowPeriodKeys(a.period, b.period)),
    [rows],
  );

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
        period: nextSimpleCashflowPeriod(rows, periodType),
        netInflow: 0,
        netOutflowExTax: 0,
        totalTax: 0,
      },
    ]);
  };

  const removeRow = (id: string) => {
    mutate(rows.filter((row) => row.id !== id));
  };

  const changePeriodType = (next: CashflowPeriodType) => {
    setPeriodType(next);
    saveStoredPeriodType(pbId, clientId, next);
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      saveStoredPeriodType(pbId, clientId, periodType);
      await onSave(simpleRowsToCashFlows(rows, cashFlows, periodType), periodType);
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
            총유입, 총유출, 총세금만 입력해 기간별 현금흐름을 관리합니다. 순자금 = 총유입 − 총유출 − 총세금.
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
        <SummaryCard label="표시기간 총유입 합계" value={totals.netInflow} tone="text-[#0D57BA]" />
        <SummaryCard label="표시기간 총유출 합계(세금 제외)" value={totals.netOutflowExTax} />
        <SummaryCard label="표시기간 총세금" value={totals.totalTax} />
        <SummaryCard
          label="표시기간 순자금"
          value={totals.netCash}
          tone={totals.netCash >= 0 ? "text-[#0D57BA]" : "text-red-600"}
        />
      </div>

      {totals.netCash < 0 && (
        <div className="mt-3 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
          순자금이 마이너스입니다. 세금 납부와 생활비 대응을 위해 유동성 높은 자산 편입이 필요합니다.
        </div>
      )}

      {detailOpen ? (
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-semibold text-fg-muted">현금흐름 입력 · 차트</p>
              <label className="flex items-center gap-1.5 text-[11px] font-bold text-fg">
                입력 주기
                <select
                  className="input py-1 text-xs"
                  value={periodType}
                  onChange={(e) => changePeriodType(e.target.value as CashflowPeriodType)}
                >
                  {CASHFLOW_PERIOD_TYPE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <button type="button" className="btn-outline text-xs" onClick={addRow}>
              + 기간 추가
            </button>
          </div>

          {rows.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-surface-2/40 px-4 py-10 text-center text-sm text-fg-muted">
              등록된 현금흐름이 없습니다. &quot;+ 기간 추가&quot;로 첫 행을 만드세요.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="min-w-full border-collapse text-left text-xs">
                <thead className="bg-surface-2 text-fg-muted">
                  <tr>
                    <th className="px-3 py-2 font-bold">기간</th>
                    <th className="px-3 py-2 font-bold">총유입</th>
                    <th className="px-3 py-2 font-bold">총유출</th>
                    <th className="px-3 py-2 font-bold">총세금</th>
                    <th className="px-3 py-2 font-bold">순자금</th>
                    <th className="px-3 py-2 font-bold" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-white">
                  {sortedRows.map((row) => {
                    const net = calcSimpleNetCash(row);
                    return (
                      <tr key={row.id}>
                        <td className="px-3 py-2">
                          <PeriodEditor
                            periodType={periodType}
                            value={row.period}
                            onChange={(period) => updateRow(row.id, { period })}
                          />
                          <p className="mt-1 text-[10px] text-fg-muted">
                            {formatCashflowPeriodLabel(row.period, periodType)}
                          </p>
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
                        <td className={`px-3 py-2 font-semibold ${net >= 0 ? "text-[#0D57BA]" : "text-red-600"}`}>
                          {formatKRW(net)}
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {chartSeries.length > 0 ? (
            <div className="rounded-md border border-border bg-surface-2/30 p-3">
              <p className="mb-2 text-xs font-bold text-fg">현금흐름 추이</p>
              <PeriodCashflowLineChart series={chartSeries} periodType={periodType} className="h-72" />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
