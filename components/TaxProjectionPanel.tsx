"use client";

import { useEffect, useMemo, useState } from "react";
import type { Client, FinancialIncomeProfile } from "@/lib/types";
import { formatKRW } from "@/lib/format";
import { formatPercent1 } from "@/lib/formatPercent";
import { isPortfolioWorkflowApproved } from "@/lib/advisory/workflowApprovals";
import {
  buildPreviewFromApprovedPortfolio,
  defaultTaxContextFromClient,
  projectPortfolioPreviewTax,
} from "@/lib/tax/portfolioPreviewTax";
import type { DepositProduct } from "@/lib/tax/depositInterest";
import { listDepositProducts } from "@/lib/deposits/store";
import HeritageHandoffBlock from "@/components/HeritageHandoffBlock";
import FinancialIncomeTaxSection from "@/components/FinancialIncomeTaxSection";
import { getPortfolioDraft } from "@/lib/store";
import {
  buildReturnAssumptionsMap,
  type PortfolioAnalyticsSnapshot,
} from "@/lib/returnAssumptions";
import { draftMatchesApprovedInstruments } from "@/lib/advisory/approvedPortfolioComposition";

interface Props {
  client: Client;
  /** 레거시 prop — 무시(종목 preview 사용) */
  baseWeights?: unknown;
  principalWon?: number;
  assetBaseEstimated?: boolean;
  onChangeComprehensiveTax?: (value: boolean) => Promise<void> | void;
  onChangeFinancialIncomeProfile?: (profile: FinancialIncomeProfile) => Promise<void> | void;
}

function StatCard({
  label,
  value,
  tone,
  pending,
}: {
  label: string;
  value: string;
  tone?: string;
  pending?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold text-fg-muted">{label}</p>
      <p
        className={`mt-1 break-words text-xl font-black tabular-nums ${pending ? "text-amber-700" : tone ?? "text-fg"}`}
      >
        {value}
      </p>
    </div>
  );
}

export default function TaxProjectionPanel({
  client,
  onChangeComprehensiveTax,
  onChangeFinancialIncomeProfile,
}: Props) {
  const portfolioReady = isPortfolioWorkflowApproved(client);
  const [assumeSale, setAssumeSale] = useState(true);
  const [openDetail, setOpenDetail] = useState(false);
  const [showIncomeForm, setShowIncomeForm] = useState(false);
  const [deposits, setDeposits] = useState<DepositProduct[]>([]);
  const [draftSnapshot, setDraftSnapshot] = useState<PortfolioAnalyticsSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listDepositProducts(client.id).then((rows) => {
      if (!cancelled) setDeposits(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [client.id]);

  useEffect(() => {
    let cancelled = false;
    const pbId = client.assignedPbId;
    const pf0 = client.portfolios?.[0];
    if (pf0?.analyticsSnapshot) {
      setDraftSnapshot(pf0.analyticsSnapshot);
    }
    if (!pbId) {
      if (!pf0?.analyticsSnapshot) setDraftSnapshot(null);
      return;
    }
    void getPortfolioDraft(pbId, client.id).then(({ draft }) => {
      if (cancelled) return;
      const pf = client.portfolios?.[0];
      if (
        draft?.analyticsSnapshot &&
        (!pf || draftMatchesApprovedInstruments(draft, pf))
      ) {
        setDraftSnapshot(draft.analyticsSnapshot);
      } else if (pf?.analyticsSnapshot) {
        setDraftSnapshot(pf.analyticsSnapshot);
      } else {
        setDraftSnapshot(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client.assignedPbId, client.id, client.portfolios]);

  const pf = client.portfolios?.[0];
  const returnAssumptions = useMemo(
    () =>
      buildReturnAssumptionsMap(draftSnapshot ?? pf?.analyticsSnapshot ?? null),
    [draftSnapshot, pf?.analyticsSnapshot],
  );

  const preview = useMemo(() => {
    if (!pf) return null;
    return buildPreviewFromApprovedPortfolio({
      client,
      portfolio: pf,
      horizonYears: 1,
      deposits,
      returnAssumptions,
    });
  }, [client, pf, deposits, returnAssumptions]);

  const taxContext = useMemo(() => defaultTaxContextFromClient(client), [client]);

  const result = useMemo(() => {
    if (!preview || preview.principalWon <= 0) return null;
    return projectPortfolioPreviewTax({
      preview,
      taxContext,
      assumeForeignShareSaleAfterHorizon: assumeSale,
    });
  }, [preview, taxContext, assumeSale]);

  if (!portfolioReady) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-8 text-center">
          <p className="text-sm font-black text-amber-900">포트폴리오 확정 후 세전·세후 계산이 가능합니다.</p>
        </div>
        <HeritageHandoffBlock client={client} />
      </div>
    );
  }

  if (!preview || !result) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-8 text-center">
          <p className="text-sm font-black text-amber-900">Portfolio preview 종목 구성이 없어 숫자를 완성할 수 없습니다.</p>
          <p className="mt-2 text-xs text-amber-800">편입 종목이 포함된 승인 구성을 확인해 주세요.</p>
        </div>
        <HeritageHandoffBlock client={client} />
      </div>
    );
  }

  const pendingIncome = result.status === "pending_income";
  const awaitingReturn = result.status === "incomplete";
  const pending = pendingIncome || awaitingReturn;
  const fmt = (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) {
      if (pendingIncome) return "입력 대기";
      if (awaitingReturn) return "산출 대기";
      return "—";
    }
    return formatKRW(v);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-bold text-fg">세전·세후 결과</h3>
          <p className="text-[11px] text-fg-muted">
            {result.scopeLabelKo} · 원금 {formatKRW(result.principalWon)} · {result.statusMessageKo}
          </p>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-fg-muted">
          <input
            type="checkbox"
            checked={assumeSale}
            onChange={(e) => setAssumeSale(e.target.checked)}
          />
          해외주식 1년 후 매도 가정
        </label>
      </div>

      {result.needsIncomeForm && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-bold text-amber-950">
            예상 금융소득이 종합과세 기준을 초과합니다. 소득 정보를 입력해 주세요.
          </p>
          <button
            type="button"
            className="btn-outline mt-2 text-xs"
            onClick={() => setShowIncomeForm((v) => !v)}
          >
            {showIncomeForm ? "입력란 접기" : "소득·납부세액 입력 열기"}
          </button>
          {showIncomeForm && onChangeComprehensiveTax && onChangeFinancialIncomeProfile && (
            <div className="mt-3">
              <FinancialIncomeTaxSection
                client={client}
                onChangeComprehensiveTax={onChangeComprehensiveTax}
                onChangeFinancialIncomeProfile={onChangeFinancialIncomeProfile}
              />
            </div>
          )}
          {showIncomeForm && !(onChangeComprehensiveTax && onChangeFinancialIncomeProfile) && (
            <p className="mt-2 text-[11px] text-amber-900">
              기본정보의 「소득·납부세액 입력」과 동일한 저장본을 사용합니다. 올해 예상 총급여 또는
              확정 비금융 과세표준을 입력한 뒤 다시 계산됩니다.
            </p>
          )}
        </div>
      )}

      {awaitingReturn && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">
          수익률 정보 확인 필요 — 세전·세후 금액을 0원으로 표시하지 않습니다.
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="세전 예상 수익" value={fmt(result.preTaxExpectedProfitWon)} pending={pending} />
        <StatCard label="추정 세금" value={fmt(result.estimatedTaxWon)} pending={pending} />
        <StatCard label="비용" value={fmt(result.costsWon)} pending={pending} />
        <StatCard
          label="세후 예상 수익"
          value={fmt(result.afterTaxExpectedProfitWon)}
          pending={pending}
          tone="text-[#1428A0]"
        />
        <StatCard
          label="세후 기말자산"
          value={fmt(result.afterTaxEndingAssetsWon)}
          pending={pending}
          tone="text-[#1428A0]"
        />
      </div>

      <div className="rounded-xl border border-border bg-white p-3 text-[11px] text-fg-muted">
        {awaitingReturn ? (
          <p>가격·배당·이자 구성은 수익률 확인 후 표시됩니다.</p>
        ) : (
          <p>
            가격 {formatKRW(result.components.priceReturnWon)} · 배당{" "}
            {formatKRW(result.components.dividendWon)} · 이자{" "}
            {formatKRW(result.components.interestWon + result.components.depositInterestWon)}
          </p>
        )}
        <p className="mt-1">
          종합과세 예상:{" "}
          {result.projectedComprehensiveTaxStatus === "above"
            ? "기준 초과"
            : result.projectedComprehensiveTaxStatus === "below"
              ? "기준 이하"
              : "확인 필요"}
          {result.preTaxExpectedProfitWon != null && result.principalWon > 0
            ? ` · 세전 수익률 ${formatPercent1((result.preTaxExpectedProfitWon / result.principalWon) * 100)}`
            : ""}
        </p>
      </div>

      <button
        type="button"
        className="text-xs font-semibold text-[#1428A0]"
        onClick={() => setOpenDetail((v) => !v)}
      >
        {openDetail ? "상세 접기" : "항목별 내역 펼치기"}
      </button>
      {openDetail && (
        <table className="w-full text-xs">
          <tbody>
            {result.breakdown.map((row) => (
              <tr key={row.label} className="border-t border-border">
                <td className="py-1.5 text-fg-muted">{row.label}</td>
                <td className="py-1.5 text-right font-semibold tabular-nums">
                  {row.amountWon == null ? (awaitingReturn ? "산출 대기" : "—") : formatKRW(row.amountWon)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <ul className="list-disc space-y-0.5 pl-4 text-[10px] text-fg-muted">
        {result.assumptions.map((a) => (
          <li key={a}>{a}</li>
        ))}
        {result.warnings.map((w) => (
          <li key={w} className="text-amber-800">
            {w}
          </li>
        ))}
      </ul>

      <HeritageHandoffBlock client={client} />
    </div>
  );
}
