"use client";

import { useMemo } from "react";
import type { Client } from "@/lib/types";
import { calculateSimulatedMetrics, type PortfolioOption } from "@/lib/portfolio";
import { formatKRW } from "@/lib/format";
import { mergeTaxProfile, projectTax } from "@/lib/taxProjection";
import { isPortfolioWorkflowApproved } from "@/lib/advisory/workflowApprovals";
import {
  financialIncomeBlockReason,
  isFinancialIncomeReadyForTax,
} from "@/lib/financialIncome";
import HeritageHandoffBlock from "@/components/HeritageHandoffBlock";

interface Props {
  client: Client;
  baseWeights: PortfolioOption["weights"];
  principalWon: number;
  assetBaseEstimated?: boolean;
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold text-fg-muted">{label}</p>
      <p className={`mt-1 text-xl font-black tabular-nums ${tone ?? "text-fg"}`}>{value}</p>
    </div>
  );
}

export default function TaxProjectionPanel({
  client,
  baseWeights,
  principalWon,
  assetBaseEstimated = false,
}: Props) {
  const portfolioReady = isPortfolioWorkflowApproved(client);
  const incomeReady = isFinancialIncomeReadyForTax(client);
  const incomeBlock = financialIncomeBlockReason(client);
  const canCompute = portfolioReady && incomeReady;

  const merged = useMemo(() => (canCompute ? mergeTaxProfile(client) : null), [canCompute, client]);
  const metrics = useMemo(
    () => calculateSimulatedMetrics(baseWeights),
    [baseWeights],
  );
  const projection = useMemo(() => {
    if (!canCompute || !merged) return null;
    return projectTax({
      principalWon,
      horizonYears: 1,
      weights: baseWeights,
      expectedReturnPct: metrics.expectedReturn,
      taxProfile: merged.profile,
      cashFlows: client.cashFlows,
      cashflowTaxSummary: merged.cashflowSummary,
      label: "기준안",
    });
  }, [baseWeights, canCompute, client.cashFlows, merged, metrics.expectedReturn, principalWon]);

  if (!portfolioReady) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-8 text-center">
          <p className="text-sm font-black text-amber-900">포트폴리오 확정 후 세전·세후 계산이 가능합니다.</p>
          <p className="mt-2 text-xs text-amber-800">
            자산군 배분을 마친 뒤 「포트폴리오 승인」을 완료하면 세전·세후 결과가 표시됩니다.
          </p>
        </div>
        <HeritageHandoffBlock client={client} />
      </div>
    );
  }

  if (!incomeReady) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-8 text-center">
          <p className="text-sm font-black text-amber-900">금융소득 입력 후 세전·세후 계산이 가능합니다.</p>
          <p className="mt-2 text-xs text-amber-800">{incomeBlock}</p>
        </div>
        <HeritageHandoffBlock client={client} />
      </div>
    );
  }

  if (!projection) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-border bg-surface-2 px-5 py-8 text-center">
          <p className="text-sm font-bold text-fg-muted">세전·세후 계산을 준비할 수 없습니다.</p>
        </div>
        <HeritageHandoffBlock client={client} />
      </div>
    );
  }

  const pretaxEnding = projection.principalWon + projection.grossReturnWon;
  const pretaxReturn = projection.grossReturnWon;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-[#1428A0]/20 bg-gradient-to-r from-white to-[#F2F5FF] p-5">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#1428A0]">Pre-tax / After-tax</p>
            <h3 className="mt-1 text-base font-black text-fg">세전·세후 결과</h3>
            <p className="mt-1 text-[11px] text-fg-muted">
              상담용 추정입니다. 세무 신고·납부 확정 금액이 아닙니다.
            </p>
          </div>
          <span className="rounded-full border border-border bg-white px-3 py-1 text-[11px] font-bold text-fg-muted">
            {assetBaseEstimated ? "등록 자산규모 기준" : "부동산 제외 운용자산 기준"} · {formatKRW(principalWon)}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
          <StatCard label="세전 예상 수익" value={formatKRW(pretaxReturn)} tone="text-emerald-700" />
          <StatCard label="추정 세금" value={formatKRW(projection.taxes.totalTaxWon)} tone="text-rose-600" />
          <StatCard label="비용" value={formatKRW(projection.feesWon)} tone="text-amber-700" />
          <StatCard
            label="세후 예상 수익"
            value={formatKRW(projection.netEndingWon - projection.principalWon)}
            tone="text-blue-700"
          />
          <StatCard label="세후 기말자산" value={formatKRW(projection.netEndingWon)} tone="text-blue-700" />
        </div>

        {(projection.taxes.overseasCapitalGainTaxWon > 0 ||
          projection.taxes.comprehensiveTaxWon > 0 ||
          client.financialIncomeComprehensiveTax) && (
          <div className="mt-4 grid gap-2 rounded-xl border border-border bg-white p-3 text-[11px] sm:grid-cols-3">
            <div>
              <p className="font-semibold text-fg-muted">금융소득 종합과세</p>
              <p className="mt-0.5 font-bold tabular-nums text-fg">
                {formatKRW(projection.taxes.comprehensiveTaxWon)}
              </p>
            </div>
            <div>
              <p className="font-semibold text-fg-muted">해외주식 양도소득세</p>
              <p className="mt-0.5 font-bold tabular-nums text-fg">
                {formatKRW(projection.taxes.overseasCapitalGainTaxWon)}
              </p>
              <p className="mt-0.5 text-[10px] text-fg-muted">금융소득 종합과세와 분리</p>
            </div>
            <div>
              <p className="font-semibold text-fg-muted">세전 기말자산</p>
              <p className="mt-0.5 font-bold tabular-nums text-fg">{formatKRW(pretaxEnding)}</p>
            </div>
          </div>
        )}
      </section>

      <HeritageHandoffBlock client={client} />
    </div>
  );
}
