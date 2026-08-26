"use client";

import type { CashFlow } from "@/lib/types";
import { buildMonthlyCashflowSummarySeries } from "@/lib/periodCashflow";
import { formatKRWShort } from "@/lib/format";
import PeriodCashflowLineChart from "@/components/cashflow/PeriodCashflowLineChart";

export default function PeriodCashflowAppendix({ cashFlows }: { cashFlows: CashFlow[] }) {
  const series = buildMonthlyCashflowSummarySeries(cashFlows);
  if (series.length < 2) return null;
  const totalIncome = series.reduce((sum, point) => sum + point.incomeWon, 0);
  const totalOutflowExTax = series.reduce((sum, point) => sum + point.outflowWon + point.savingWon, 0);
  const totalTax = series.reduce((sum, point) => sum + point.taxWon, 0);
  const totalNet = series.reduce((sum, point) => sum + point.netWon, 0);

  return (
    <section className="card mb-4 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-fg">월별 간소화 현금흐름</h3>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">
            세부항목 대신 월별 <b>순유입</b>, <b>순유출(세금 제외)</b>, <b>총세금</b>만 집계합니다.
            월 순자금은 순유입에서 순유출과 총세금을 차감한 값입니다.
          </p>
        </div>
        <span className="rounded-full border border-border px-2 py-1 text-[10px] font-bold text-fg-muted">
          {series.length}개월
        </span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <SummaryCard label="기간 순유입" value={formatKRWShort(totalIncome)} />
        <SummaryCard label="기간 순유출" value={formatKRWShort(totalOutflowExTax)} tone="text-red-600" />
        <SummaryCard label="기간 총세금" value={formatKRWShort(totalTax)} tone="text-violet-700" />
        <SummaryCard label="기간 순자금" value={formatKRWShort(totalNet)} tone={totalNet < 0 ? "text-red-600" : "text-[#1428A0]"} />
      </div>

      <div className="h-80 rounded-xl border border-border bg-surface-2 p-3">
        <PeriodCashflowLineChart series={series} className="h-full" />
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="border-b border-border bg-surface-2 text-fg-muted">
            <tr>
                <th className="px-3 py-2 text-left">기간</th>
              <th className="px-3 py-2 text-right">순유입</th>
              <th className="px-3 py-2 text-right">순유출(세금 제외)</th>
              <th className="px-3 py-2 text-right">총세금</th>
              <th className="px-3 py-2 text-right">월 순자금</th>
              <th className="px-3 py-2 text-right">누적</th>
            </tr>
          </thead>
          <tbody>
            {series.map((point) => (
              <tr key={point.period} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2 font-semibold text-fg">{point.period}</td>
                <td className="px-3 py-2 text-right">{formatKRWShort(point.incomeWon)}</td>
                <td className="px-3 py-2 text-right text-red-500">{formatKRWShort(point.outflowWon + point.savingWon)}</td>
                <td className="px-3 py-2 text-right text-violet-700">{formatKRWShort(point.taxWon)}</td>
                <td className={`px-3 py-2 text-right font-bold ${point.netWon < 0 ? "text-red-500" : "text-gold-600"}`}>
                  {formatKRWShort(point.netWon)}
                </td>
                <td className={`px-3 py-2 text-right font-bold ${point.cumulativeNetWon < 0 ? "text-red-500" : "text-fg"}`}>
                  {formatKRWShort(point.cumulativeNetWon)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SummaryCard({ label, value, tone = "text-[#1428A0]" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 px-3 py-2">
      <p className="text-[11px] font-bold text-fg-muted">{label}</p>
      <p className={`mt-1 text-base font-black ${tone}`}>{value}</p>
    </div>
  );
}
