/**
 * 고객용 IPS A4 요약 문서 본문.
 * 화면·인쇄 공통. 인쇄는 globals.css 의 .ips-a4-* / @page ips-summary 규칙을 사용한다.
 */

"use client";

import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { Client, Portfolio } from "@/lib/types";
import { ACCOUNT_SEPARATION_LABEL, CLIENT_TYPE_LABEL, FACTOR_META } from "@/lib/types";
import { formatKRW, formatDate } from "@/lib/format";
import { formatPercent1, formatPercentPoint1 } from "@/lib/formatPercent";
import {
  buildPortfolioViewModel,
  resolvePortfolioDisplayAllocations,
} from "@/lib/portfolio";
import {
  buildReturnContributionResult,
} from "@/lib/portfolioReturnContribution";
import {
  isLegacyIncompletePortfolio,
  portfolioHasDisplayableMetrics,
} from "@/lib/advisory/approvedPortfolioComposition";
import { HONESTY_LIMITS } from "@/lib/advisory/constants";
import { mergeTaxProfile, projectTax } from "@/lib/taxProjection";
import { DEFAULT_HORIZON_YEARS } from "@/lib/taxProjectionRules";
import {
  isPortfolioWorkflowApproved,
} from "@/lib/advisory/workflowApprovals";
import { isFinancialIncomeReadyForTax } from "@/lib/financialIncome";
import { buildMonthlyCashflowSummarySeries } from "@/lib/periodCashflow";
import type { TaxPaymentEvent } from "@/lib/cashflowUpload";
import { scoreReadinessEvents } from "@/lib/taxReadinessScoring";
import TaxReadinessRubricButton from "@/components/TaxReadinessRubricButton";
import PeriodCashflowLineChart from "@/components/cashflow/PeriodCashflowLineChart";

const CHART_COLORS = ["#1428A0", "#2C3EE8", "#64748B", "#0F172A", "#94A3B8", "#334155"];

const formatManwon = (won: number) => `${Math.round(won / 10_000).toLocaleString()}만원`;

const taxText = (flow: Client["cashFlows"][number]) =>
  `${flow.label} ${flow.category ?? ""} ${flow.taxAccountingNote ?? ""} ${flow.accountType ?? ""}`;

function classifyCashflow(flow: Client["cashFlows"][number]) {
  const text = taxText(flow);
  if (/현금성자산|현재현금|자산|asset/i.test(text)) return "현금성자산";
  if (/세|tax|증여|상속|양도|종부|재산|법인세|부가세/i.test(text)) return "세금/이벤트";
  if (/저축|투자|CMA|MMF|RP|ETF|ISA|IRP|연금|적금/i.test(text)) return "저축/투자";
  if (flow.amount > 0) return "소득";
  return "지출";
}

function dueDateFromMonth(month: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(month)) return month;
  if (/^\d{4}-\d{2}$/.test(month)) return `${month}-28`;
  return "";
}

function previousMonthEnd(dateInput: string) {
  const date = new Date(`${dateInput}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getFullYear(), date.getMonth(), 0).toISOString().slice(0, 10);
}

function buildTaxSchedule(
  cashFlows: Client["cashFlows"],
  currentCashWon: number,
  monthlyNetWon: number,
): TaxPaymentEvent[] {
  const events: Array<Omit<TaxPaymentEvent, "status" | "readiness">> = cashFlows
    .filter((flow) => flow.amount < 0 && /세|tax|증여|상속|양도|종부|재산|법인세|부가세/i.test(taxText(flow)))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .slice(0, 8)
    .map((flow) => {
      const dueDate = dueDateFromMonth(flow.date) || new Date().toISOString().slice(0, 10);
      const amountWon = Math.abs(flow.amount);
      return {
        id: `ips-tax-${flow.id}`,
        label: flow.label || "세금 이벤트",
        amountWon,
        dueDate,
        cashReadyDate: previousMonthEnd(dueDate) || dueDate,
        rule: flow.taxAccountingNote || "상담용 추정, 세무 전문가 확인 필요",
      };
    });
  return scoreReadinessEvents({ currentCashWon, monthlyNetWon, events });
}

function buildCashflowSummary(cashFlows: Client["cashFlows"]) {
  const recurringIn = cashFlows
    .filter((flow) => flow.recurring && flow.amount > 0)
    .reduce((sum, flow) => sum + flow.amount, 0);
  const recurringOut = cashFlows
    .filter((flow) => flow.recurring && flow.amount < 0)
    .reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
  const monthlyNet = recurringIn - recurringOut;
  const currentCashWon = cashFlows
    .filter((flow) => /현금성자산|현재현금|CMA|MMF|RP|cash/i.test(taxText(flow)) && flow.amount > 0)
    .reduce((sum, flow) => sum + flow.amount, 0);
  const byGroup = new Map<string, { item: string; annualizedAmount: number }>();
  for (const flow of cashFlows) {
    const group = classifyCashflow(flow);
    const prev = byGroup.get(group);
    const annual = flow.recurring ? flow.amount * 12 : flow.amount;
    if (!prev) byGroup.set(group, { item: flow.label || group, annualizedAmount: annual });
    else prev.annualizedAmount += annual;
  }
  const summaryRows = Array.from(byGroup.entries()).map(([group, v]) => ({
    group,
    item: v.item,
    annualizedAmount: v.annualizedAmount,
  }));
  const goals = cashFlows
    .filter((f) => /목표|goal/i.test(taxText(f)))
    .slice(0, 4)
    .map((f) => ({
      goal: f.label || "재무목표",
      targetDate: f.date || "미정",
      amount: Math.abs(f.amount),
      priority: "점검",
      note: f.taxAccountingNote || "",
    }));
  const upcoming = [...cashFlows]
    .filter((f) => f.date)
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
    .slice(0, 6);
  return {
    recurringIn,
    recurringOut,
    monthlyNet,
    currentCashWon,
    summaryRows,
    taxSchedule: buildTaxSchedule(cashFlows, currentCashWon, monthlyNet),
    goals,
    upcoming,
  };
}

function buildSummary(client: Client, investableWon: number | null): string {
  const ips = client.ips;
  const t = CLIENT_TYPE_LABEL[client.clientType];
  const seg: string[] = [];
  seg.push(
    `${client.name} 고객은 ${t} 고객으로, 투자가능자산 ${formatKRW(investableWon ?? client.assetSize)} 수준입니다.`,
  );
  const profile: string[] = [];
  if (ips.timeHorizon.value) profile.push(`투자 기간 ${ips.timeHorizon.value}`);
  if (ips.risk.value) profile.push(`위험 허용도 ${ips.risk.value}`);
  if (ips.return.value) profile.push(`목표 수익률 ${ips.return.value}`);
  if (profile.length) seg.push(`${profile.join(", ")} 수준으로 파악됩니다.`);
  const extra: string[] = [];
  if (ips.liquidity.value) extra.push(`유동성은 ${ips.liquidity.value}`);
  if (ips.tax.value) extra.push(`세금 측면은 ${ips.tax.value}`);
  if (ips.legal.value) extra.push(`법적 제약은 ${ips.legal.value}`);
  if (ips.unique.value) extra.push(`특이사항으로 ${ips.unique.value}`);
  if (extra.length) seg.push(`${extra.join(", ")} 등이 고려됩니다.`);
  seg.push(
    "이를 종합해 위험 분산과 목표 수익·세금·유동성을 균형 있게 반영한 자산배분을 권고합니다.",
  );
  return seg.join(" ");
}

function metricLabel(pf: Portfolio | undefined, kind: "return" | "risk"): string {
  if (!pf) return "—";
  if (isLegacyIncompletePortfolio(pf)) return "확인 필요";
  if (!portfolioHasDisplayableMetrics(pf)) return "산출 전";
  return formatPercent1(kind === "return" ? pf.expectedReturn : pf.expectedRisk);
}

const HOLDINGS_PAGE1_MAX = 12;

export default function IpsA4Document({
  documentClient,
  documentPbDisplay,
  investableWon,
  dateStr,
}: {
  documentClient: Client;
  documentPbDisplay: string;
  investableWon: number | null;
  dateStr: string;
}) {
  const pf = documentClient.portfolios[0];
  const cashflowSummary = buildCashflowSummary(documentClient.cashFlows);
  const confirmedWeights = pf
    ? buildPortfolioViewModel(documentClient).portfolioOptions.find((option) => option.id === pf.id)
        ?.weights
    : undefined;
  const displayAllocations = pf ? resolvePortfolioDisplayAllocations(pf, confirmedWeights) : [];
  const allocationChartData = displayAllocations.map((allocation) => ({
    name: allocation.assetClass,
    value: allocation.weight,
  }));
  const metricsOk = portfolioHasDisplayableMetrics(pf);
  const contribution = pf
    ? buildReturnContributionResult(
        displayAllocations,
        metricsOk ? pf.expectedReturn : null,
        undefined,
        { allowFallbackProxy: false },
      )
    : null;
  const showContribution =
    contribution?.status === "ok" &&
    contribution.rows.length > 0 &&
    contribution.agreesWithExpected;
  const periodSeries = buildMonthlyCashflowSummarySeries(documentClient.cashFlows);
  const vmWeights = confirmedWeights ?? {
    etf: 30,
    bond: 25,
    els: 0,
    mmf: 30,
    gold: 10,
    dollar: 5,
    raw: 0,
  };
  const taxReady =
    isPortfolioWorkflowApproved(documentClient) &&
    isFinancialIncomeReadyForTax(documentClient) &&
    metricsOk &&
    pf?.expectedReturn != null;
  const mergedTax = taxReady ? mergeTaxProfile(documentClient) : null;
  const taxWaterfall =
    taxReady && mergedTax
      ? projectTax({
          principalWon: investableWon ?? documentClient.assetSize,
          horizonYears: DEFAULT_HORIZON_YEARS,
          weights: vmWeights,
          expectedReturnPct: pf!.expectedReturn!,
          taxProfile: mergedTax.profile,
          cashFlows: documentClient.cashFlows,
          cashflowTaxSummary: mergedTax.cashflowSummary,
          label: pf?.label ?? "기준안",
        })
      : null;

  const instruments = pf?.instruments ?? [];
  const page1Holdings = instruments.slice(0, HOLDINGS_PAGE1_MAX);
  const appendixHoldings = instruments.slice(HOLDINGS_PAGE1_MAX);
  const legacyIncomplete = isLegacyIncompletePortfolio(pf);

  return (
    <div className="ips-a4-root rounded-lg bg-white text-gray-900 shadow-card print:rounded-none print:bg-white print:shadow-none">
      {/* ── 1페이지: A4 요약 ── */}
      <div className="ips-a4-sheet ips-a4-summary px-6 py-5 print:px-0 print:py-0">
        <header className="border-b border-[#1428A0]/30 pb-2 text-center">
          <p className="text-[9px] font-semibold tracking-[0.18em] text-[#1428A0]">
            SAMSUNG SECURITIES · PRIVATE BANKING
          </p>
          <h1 className="mt-0.5 text-[16px] font-bold leading-tight text-[#0F172A]">
            투자정책서 (IPS) 요약
          </h1>
          <p className="mt-0.5 text-[9px] text-gray-500">
            {dateStr} · 문서번호 IPS-{documentClient.code}
          </p>
        </header>

        <section className="ips-a4-section mt-2">
          <h2 className="ips-a4-h2">고객 · 담당 PB</h2>
          <table className="ips-a4-table w-full">
            <tbody>
              <tr>
                <td className="ips-a4-muted">고객</td>
                <td className="font-semibold">
                  {documentClient.name} ({CLIENT_TYPE_LABEL[documentClient.clientType]})
                </td>
                <td className="ips-a4-muted">식별코드</td>
                <td>{documentClient.code}</td>
              </tr>
              <tr>
                <td className="ips-a4-muted">
                  {documentClient.clientType === "corporate" ? "설립일" : "생년월일"}
                </td>
                <td>{formatDate(documentClient.birthDate)}</td>
                <td className="ips-a4-muted">투자가능자산</td>
                <td className="font-semibold">
                  {formatKRW(investableWon ?? documentClient.assetSize)}
                </td>
              </tr>
              <tr>
                <td className="ips-a4-muted">담당 PB</td>
                <td>{documentPbDisplay}</td>
                <td className="ips-a4-muted">통장·지분</td>
                <td>
                  {documentClient.accountSeparation
                    ? ACCOUNT_SEPARATION_LABEL[documentClient.accountSeparation]
                    : documentClient.ownershipPct != null
                      ? `${formatPercent1(documentClient.ownershipPct)}${
                          documentClient.isMajorityShareholder ? " · 최대주주" : ""
                        }`
                      : "—"}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="ips-a4-section mt-2">
          <h2 className="ips-a4-h2">투자 목적 · 제약</h2>
          <p className="text-[9.5px] leading-snug text-gray-700">
            {buildSummary(documentClient, investableWon)}
          </p>
          <table className="ips-a4-table mt-1.5 w-full">
            <thead>
              <tr>
                <th className="w-[22%]">요인</th>
                <th>내용</th>
              </tr>
            </thead>
            <tbody>
              {FACTOR_META.map((m) => {
                const f = documentClient.ips[m.key];
                const value =
                  f.value ||
                  (f.status === "inferred" && f.inferenceHint
                    ? `참고: ${f.inferenceHint}`
                    : "—");
                return (
                  <tr key={m.key}>
                    <td className="font-semibold">{m.label}</td>
                    <td>{value}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="ips-a4-section mt-2">
          <h2 className="ips-a4-h2">확정 포트폴리오 구성</h2>
          {!pf ? (
            <p className="text-[9.5px] text-gray-500">확정된 포트폴리오가 없습니다.</p>
          ) : legacyIncomplete && !instruments.length ? (
            <p className="text-[9.5px] font-semibold text-amber-800">
              편입 종목 상세가 없는 이전 승인 기록입니다. 포트폴리오를 다시 확인해 주세요.
            </p>
          ) : (
            <>
              <div className="mb-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[9.5px]">
                <span>
                  <b>유형</b> {pf.label}
                </span>
                <span>
                  <b>예상수익률</b> {metricLabel(pf, "return")}
                </span>
                <span>
                  <b>예상변동성</b> {metricLabel(pf, "risk")}
                </span>
              </div>
              <p className="mb-1.5 text-[8.5px] leading-snug text-gray-500">
                아래 비중·수량은 승인 시점 장부 기준이며, 증권사 주문·체결 내역이 아닙니다.
                수익률·변동성은 참고 추정치로 미래 성과를 보장하지 않습니다.
              </p>

              <div className="grid grid-cols-[1fr_120px] gap-2">
                <div>
                  <table className="ips-a4-table w-full">
                    <thead>
                      <tr>
                        <th>종목</th>
                        <th>자산군</th>
                        <th className="text-right">군내</th>
                        <th className="text-right">전체</th>
                        <th className="text-right">배정</th>
                        <th className="text-right">수량</th>
                      </tr>
                    </thead>
                    <tbody>
                      {page1Holdings.map((row) => (
                        <tr key={row.symbol}>
                          <td>
                            <span className="font-semibold">{row.name}</span>
                            <span className="ml-1 text-gray-400">{row.symbol}</span>
                          </td>
                          <td>{row.assetClassLabel}</td>
                          <td className="text-right">{formatPercent1(row.weightWithinClass)}</td>
                          <td className="text-right font-semibold">
                            {formatPercent1(row.totalWeightPct)}
                          </td>
                          <td className="text-right">
                            {row.allocationAmountWon != null
                              ? formatKRW(row.allocationAmountWon)
                              : "—"}
                          </td>
                          <td className="text-right">
                            {row.quantity != null && Number.isFinite(row.quantity)
                              ? row.quantity.toLocaleString()
                              : "—"}
                          </td>
                        </tr>
                      ))}
                      {!page1Holdings.length && (
                        <tr>
                          <td colSpan={6} className="text-gray-500">
                            편입 종목이 없습니다.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  {appendixHoldings.length > 0 && (
                    <p className="mt-1 text-[8.5px] font-semibold text-[#1428A0]">
                      ※ 나머지 {appendixHoldings.length}개 종목은 부록(추가 페이지)에 수록합니다.
                    </p>
                  )}
                </div>
                <div className="ips-a4-mini-chart flex flex-col items-center justify-start">
                  <p className="mb-0.5 text-[8.5px] font-semibold text-gray-600">자산군 비중</p>
                  <div className="h-[88px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={allocationChartData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={18}
                          outerRadius={36}
                          paddingAngle={1}
                          isAnimationActive={false}
                        >
                          {allocationChartData.map((entry, index) => (
                            <Cell
                              key={entry.name}
                              fill={CHART_COLORS[index % CHART_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: unknown) => formatPercent1(Number(value))}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-0.5 w-full space-y-0.5 text-[7.5px] leading-tight text-gray-600">
                    {allocationChartData.map((entry, index) => (
                      <div key={entry.name} className="flex items-center gap-1">
                        <span
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                        />
                        <span className="truncate">
                          {entry.name} {formatPercent1(entry.value)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {showContribution && contribution && (
                <div className="mt-1.5">
                  <p className="text-[8.5px] font-semibold text-gray-700">자산군별 수익률 기여도</p>
                  <table className="ips-a4-table mt-0.5 w-full">
                    <thead>
                      <tr>
                        <th>자산군</th>
                        <th className="text-right">비중</th>
                        <th className="text-right">적용수익률</th>
                        <th className="text-right">기여도</th>
                      </tr>
                    </thead>
                    <tbody>
                      {contribution.rows.map((c) => (
                        <tr key={c.name}>
                          <td>{c.name}</td>
                          <td className="text-right">{formatPercent1(c.weightPct)}</td>
                          <td className="text-right">{formatPercent1(c.appliedReturnPct)}</td>
                          <td className="text-right font-semibold">
                            {formatPercentPoint1(c.contributionPct)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-0.5 text-[8px] text-gray-500">
                    기여도 합 {formatPercentPoint1(contribution.sumContributionPct)} · 포트폴리오
                    예상수익률 {formatPercent1(pf.expectedReturn)}
                  </p>
                </div>
              )}
              {contribution?.status === "unavailable" && (
                <p className="mt-1 text-[8.5px] text-gray-500">
                  수익률 기여도: 산출 전 (표시하지 않음)
                </p>
              )}
              {contribution?.status === "ok" && !contribution.agreesWithExpected && (
                <p className="mt-1 text-[8.5px] font-semibold text-amber-800">
                  기여도 합과 예상수익률이 일치하지 않아 차트를 표시하지 않습니다. 확인이
                  필요합니다.
                </p>
              )}
            </>
          )}
        </section>

        <section className="ips-a4-section mt-2">
          <h2 className="ips-a4-h2">현금흐름 요약</h2>
          {documentClient.cashFlows.length === 0 ? (
            <p className="text-[9.5px] text-gray-500">등록된 현금흐름이 없습니다.</p>
          ) : (
            <div className="grid grid-cols-4 gap-1.5 text-[9px]">
              <CompactMetric label="월 총소득" value={formatManwon(cashflowSummary.recurringIn)} />
              <CompactMetric
                label="월 총지출"
                value={formatManwon(cashflowSummary.recurringOut)}
                danger
              />
              <CompactMetric
                label="월 순현금흐름"
                value={formatManwon(cashflowSummary.monthlyNet)}
                danger={cashflowSummary.monthlyNet < 0}
              />
              <CompactMetric
                label="현금성자산"
                value={formatManwon(cashflowSummary.currentCashWon)}
              />
            </div>
          )}
        </section>

        <section className="ips-a4-section mt-2">
          <h2 className="ips-a4-h2">세전·세후 요약</h2>
          {taxWaterfall ? (
            <table className="ips-a4-table w-full">
              <tbody>
                <tr>
                  <td>세전 기말자산</td>
                  <td className="text-right font-semibold">
                    {formatKRW(taxWaterfall.principalWon + taxWaterfall.grossReturnWon)}
                  </td>
                </tr>
                <tr>
                  <td>예상 세금</td>
                  <td className="text-right">−{formatKRW(taxWaterfall.taxes.totalTaxWon)}</td>
                </tr>
                <tr>
                  <td>상품/거래 비용</td>
                  <td className="text-right">−{formatKRW(taxWaterfall.feesWon)}</td>
                </tr>
                <tr>
                  <td className="font-bold">세후 기말자산</td>
                  <td className="text-right font-bold">{formatKRW(taxWaterfall.netEndingWon)}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <p className="text-[9.5px] text-gray-500">
              {metricsOk
                ? "세전·세후 계산 조건이 충족되지 않았습니다."
                : "예상수익률 산출 전 — 세전·세후 요약을 표시하지 않습니다."}
            </p>
          )}
        </section>

        <div className="ips-a4-disclaimer mt-2 border border-gray-300 bg-gray-50 p-2 text-[8px] leading-snug text-gray-600">
          ※ 본 투자정책서는 PB 상담 내용을 구조화한 <b>참고용 문서</b>이며 투자 권유가
          아닙니다. 포트폴리오·스트레스 결과는 통계적 추정치로 미래 수익을 보장하지 않으며,
          실제 투자 결정 및
          {HONESTY_LIMITS.map((line) => (
            <span key={line}> {line}</span>
          ))}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-6 text-[9.5px]">
          <div>
            <p className="mb-6 text-gray-500">담당 PB</p>
            <div className="border-t border-gray-400 pt-0.5 text-center text-[8.5px] text-gray-500">
              (서명)
            </div>
          </div>
          <div>
            <p className="mb-6 text-gray-500">고객</p>
            <div className="border-t border-gray-400 pt-0.5 text-center text-[8.5px] text-gray-500">
              {documentClient.name} (서명)
            </div>
          </div>
        </div>
        <p className="mt-2 text-center text-[8px] text-gray-400">
          삼성증권 PB센터 · {dateStr} 생성
        </p>
      </div>

      {/* ── 부록: 화면에서는 항상, 인쇄 시 별도 페이지 ── */}
      {(appendixHoldings.length > 0 ||
        documentClient.cashFlows.length > 0 ||
        periodSeries.length >= 2) && (
        <div className="ips-a4-appendix mt-6 border-t border-dashed border-gray-300 px-6 py-5 print:mt-0 print:border-0 print:px-0 print:py-0">
          <p className="mb-2 text-[11px] font-bold text-[#1428A0] print:text-[10px]">
            부록 — 상세 자료 (요약 페이지와 별도)
          </p>

          {appendixHoldings.length > 0 && (
            <section className="ips-a4-section mb-3">
              <h2 className="ips-a4-h2">추가 편입 종목</h2>
              <table className="ips-a4-table w-full">
                <thead>
                  <tr>
                    <th>종목</th>
                    <th>자산군</th>
                    <th className="text-right">군내</th>
                    <th className="text-right">전체</th>
                    <th className="text-right">배정</th>
                    <th className="text-right">수량</th>
                    <th className="text-right">시세</th>
                  </tr>
                </thead>
                <tbody>
                  {appendixHoldings.map((row) => (
                    <tr key={row.symbol}>
                      <td>
                        <span className="font-semibold">{row.name}</span>
                        <span className="ml-1 text-gray-400">{row.symbol}</span>
                      </td>
                      <td>{row.assetClassLabel}</td>
                      <td className="text-right">{formatPercent1(row.weightWithinClass)}</td>
                      <td className="text-right">{formatPercent1(row.totalWeightPct)}</td>
                      <td className="text-right">
                        {row.allocationAmountWon != null
                          ? formatKRW(row.allocationAmountWon)
                          : "—"}
                      </td>
                      <td className="text-right">
                        {row.quantity != null ? row.quantity.toLocaleString() : "—"}
                      </td>
                      <td className="text-right">
                        {row.priceSnapshot != null
                          ? `${row.currency} ${row.priceSnapshot.toLocaleString()}`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {documentClient.cashFlows.length > 0 && (
            <section className="ips-a4-section mb-3">
              <h2 className="ips-a4-h2">현금흐름·세금 일정 상세</h2>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-[9px] text-gray-500">상담 입력 기준 추정치</p>
                <TaxReadinessRubricButton
                  label="준비상태 기준표"
                  className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[10px] font-bold text-gray-500 hover:border-gray-600 hover:text-gray-900 print:hidden"
                />
              </div>
              {cashflowSummary.taxSchedule.length === 0 ? (
                <p className="text-[9px] text-gray-400">세금성 이벤트가 입력되지 않았습니다.</p>
              ) : (
                <table className="ips-a4-table w-full">
                  <thead>
                    <tr>
                      <th>세금/이벤트</th>
                      <th className="text-right">예상세액</th>
                      <th>납부기한</th>
                      <th>현금화 목표</th>
                      <th className="text-center">준비</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cashflowSummary.taxSchedule.map((event) => (
                      <tr key={event.id}>
                        <td>
                          <p className="font-medium">{event.label}</p>
                          <p className="text-[8px] text-gray-500">{event.readiness.reason}</p>
                        </td>
                        <td className="text-right">{formatManwon(event.amountWon)}</td>
                        <td>{event.dueDate}</td>
                        <td>{event.cashReadyDate}</td>
                        <td className="text-center">
                          <StatusBadge status={event.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}

          {periodSeries.length >= 2 && (
            <section className="ips-a4-section">
              <h2 className="ips-a4-h2">월별 간소화 현금흐름</h2>
              <div className="mb-2 h-48 print:h-40">
                <PeriodCashflowLineChart series={periodSeries} className="h-full" />
              </div>
              <table className="ips-a4-table w-full">
                <thead>
                  <tr>
                    <th>기간</th>
                    <th className="text-right">유입</th>
                    <th className="text-right">유출</th>
                    <th className="text-right">세금</th>
                    <th className="text-right">순자금</th>
                    <th className="text-right">누적</th>
                  </tr>
                </thead>
                <tbody>
                  {periodSeries.map((point) => (
                    <tr key={point.period}>
                      <td className="font-semibold">{point.period}</td>
                      <td className="text-right">{formatManwon(point.incomeWon)}</td>
                      <td className="text-right text-red-600">
                        {formatManwon(point.outflowWon + point.savingWon)}
                      </td>
                      <td className="text-right">{formatManwon(point.taxWon)}</td>
                      <td className="text-right">{formatManwon(point.netWon)}</td>
                      <td className="text-right">{formatManwon(point.cumulativeNetWon)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function CompactMetric({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded border border-gray-200 bg-gray-50 px-2 py-1">
      <p className="text-[8px] font-semibold text-gray-500">{label}</p>
      <p className={`text-[10px] font-bold ${danger ? "text-red-600" : "text-gray-900"}`}>
        {value}
      </p>
    </div>
  );
}

function StatusBadge({ status }: { status: TaxPaymentEvent["status"] }) {
  const label = status === "covered" ? "커버" : status === "watch" ? "점검" : "부족";
  const cls =
    status === "covered"
      ? "border-green-200 bg-green-50 text-green-700"
      : status === "watch"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-red-200 bg-red-50 text-red-700";
  return (
    <span className={`inline-block rounded-full border px-1.5 py-0.5 text-[8px] font-bold ${cls}`}>
      {label}
    </span>
  );
}
