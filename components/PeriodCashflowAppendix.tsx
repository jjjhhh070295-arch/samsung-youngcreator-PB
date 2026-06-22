"use client";

import type { CashFlow } from "@/lib/types";
import { buildPeriodCashflowSeries } from "@/lib/periodCashflow";
import { formatKRWShort } from "@/lib/format";
import PeriodCashflowLineChart from "@/components/cashflow/PeriodCashflowLineChart";

export default function PeriodCashflowAppendix({ cashFlows }: { cashFlows: CashFlow[] }) {
  const series = buildPeriodCashflowSeries(cashFlows);
  if (series.length < 2) return null;

  return (
    <section className="card mb-4 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-fg">부록 · 기간별 현금흐름 추이</h3>
          <p className="mt-1 text-xs leading-relaxed text-fg-muted">
            XLSX의 <b>부록_기간별현금흐름</b> 시트와 메인 세금일정에서 읽은 유입·유출·저축·세금·순현금흐름 (만원)을 선그래프로 표시합니다.
          </p>
        </div>
        <span className="rounded-full border border-border px-2 py-1 text-[10px] font-bold text-fg-muted">
          {series.length}개월
        </span>
      </div>

      <div className="h-64 rounded-xl border border-border bg-surface-2 p-3">
        <PeriodCashflowLineChart series={series} className="h-full" />
      </div>

      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="border-b border-border bg-surface-2 text-fg-muted">
            <tr>
              <th className="px-3 py-2 text-left">기간</th>
              <th className="px-3 py-2 text-right">유입</th>
              <th className="px-3 py-2 text-right">유출</th>
              <th className="px-3 py-2 text-right">저축/투자</th>
              <th className="px-3 py-2 text-right">세금</th>
              <th className="px-3 py-2 text-right">순현금흐름</th>
              <th className="px-3 py-2 text-right">누적</th>
              <th className="px-3 py-2 text-left">메모</th>
            </tr>
          </thead>
          <tbody>
            {series.map((point) => (
              <tr key={point.period} className="border-b border-border/60 last:border-0">
                <td className="px-3 py-2 font-semibold text-fg">{point.period}</td>
                <td className="px-3 py-2 text-right">{formatKRWShort(point.incomeWon)}</td>
                <td className="px-3 py-2 text-right text-red-500">{formatKRWShort(point.outflowWon)}</td>
                <td className="px-3 py-2 text-right">{formatKRWShort(point.savingWon)}</td>
                <td className="px-3 py-2 text-right">{formatKRWShort(point.taxWon)}</td>
                <td className={`px-3 py-2 text-right font-bold ${point.netWon < 0 ? "text-red-500" : "text-gold-600"}`}>
                  {formatKRWShort(point.netWon)}
                </td>
                <td className={`px-3 py-2 text-right font-bold ${point.cumulativeNetWon < 0 ? "text-red-500" : "text-fg"}`}>
                  {formatKRWShort(point.cumulativeNetWon)}
                </td>
                <td className="max-w-[240px] px-3 py-2 text-fg-muted">{point.memo || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
