"use client";

// 투자정책서(IPS) 문서 — 인쇄/PDF 저장용. 고객 데이터로 자동 생성.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Client, PB } from "@/lib/types";
import { ACCOUNT_SEPARATION_LABEL, CLIENT_TYPE_LABEL, FACTOR_META } from "@/lib/types";
import { getClient, listPbs } from "@/lib/store";
import { formatKRW, formatDate } from "@/lib/format";
import {
  buildPortfolioViewModel,
  resolvePortfolioDisplayAllocations,
} from "@/lib/portfolio";
import { buildReturnContributionsFromPortfolio } from "@/lib/portfolioReturnContribution";
import { scoreReadinessEvents } from "@/lib/taxReadinessScoring";
import { buildPeriodCashflowSeries } from "@/lib/periodCashflow";
import type { TaxPaymentEvent } from "@/lib/cashflowUpload";
import TaxReadinessRubricButton from "@/components/TaxReadinessRubricButton";
import PeriodCashflowLineChart from "@/components/cashflow/PeriodCashflowLineChart";
import { LoadingView, ErrorView } from "@/components/StateViews";
import { canIssueClientPdf, loadBundle, pdfBlockReason } from "@/lib/advisory/control";
import { HONESTY_LIMITS, AI_ROLE_COPY } from "@/lib/advisory/constants";
import { mergeTaxProfile, projectTax } from "@/lib/taxProjection";
import { DEFAULT_HORIZON_YEARS } from "@/lib/taxProjectionRules";

const CHART_COLORS = ["#0f172a", "#d6a84f", "#2563eb", "#10b981", "#ef4444", "#8b5cf6", "#64748b"];

const taxText = (flow: Client["cashFlows"][number]) =>
  `${flow.label} ${flow.category ?? ""} ${flow.taxAccountingNote ?? ""} ${flow.accountType ?? ""}`;

const formatManwon = (won: number) => `${Math.round(won / 10_000).toLocaleString()}만원`;

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

function buildTaxSchedule(cashFlows: Client["cashFlows"], currentCashWon: number, monthlyNetWon: number): TaxPaymentEvent[] {
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
  const recurringIn = cashFlows.filter((flow) => flow.recurring && flow.amount > 0).reduce((sum, flow) => sum + flow.amount, 0);
  const recurringOut = cashFlows.filter((flow) => flow.recurring && flow.amount < 0).reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
  const oneOffIn = cashFlows.filter((flow) => !flow.recurring && flow.amount > 0).reduce((sum, flow) => sum + flow.amount, 0);
  const oneOffOut = cashFlows.filter((flow) => !flow.recurring && flow.amount < 0).reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
  const currentCashWon = cashFlows
    .filter((flow) => /현금성자산|현재현금|CMA|MMF|RP|cash/i.test(taxText(flow)) && flow.amount > 0)
    .reduce((sum, flow) => sum + flow.amount, 0);
  const taxOut = cashFlows
    .filter((flow) => flow.amount < 0 && /세|tax|증여|상속|양도|부가세|종부|법인세/i.test(`${flow.label} ${flow.category ?? ""}`))
    .reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
  const grouped = cashFlows.reduce<Record<string, number>>((acc, flow) => {
    const group = classifyCashflow(flow);
    acc[group] = (acc[group] ?? 0) + flow.amount;
    return acc;
  }, {});
  const summaryRows = Object.entries(grouped).map(([group, amount]) => ({
    group,
    item: group === "소득" ? "월 반복/일회 유입" : group === "지출" ? "생활비/운영비" : group,
    amount,
    annualizedAmount: cashFlows
      .filter((flow) => classifyCashflow(flow) === group)
      .reduce((sum, flow) => sum + (flow.recurring ? flow.amount * 12 : flow.amount), 0),
  }));
  const monthlyNet = recurringIn - recurringOut;
  const taxSchedule = buildTaxSchedule(cashFlows, currentCashWon, monthlyNet);
  const goals = cashFlows
    .filter((flow) => !flow.recurring && flow.amount < 0 && !/세|tax/i.test(taxText(flow)))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 5)
    .map((flow) => ({
      goal: flow.label || "재무목표",
      targetDate: flow.date || "미정",
      amount: Math.abs(flow.amount),
      priority: /증여|상속|주택|부동산|CAPEX/i.test(taxText(flow)) ? "상" : "중",
      note: flow.taxAccountingNote || flow.category || "현금화 계획 필요",
    }));
  const upcoming = cashFlows
    .filter((flow) => flow.date)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6);

  return {
    recurringIn,
    recurringOut,
    oneOffIn,
    oneOffOut,
    currentCashWon,
    taxOut,
    net: recurringIn + oneOffIn - recurringOut - oneOffOut,
    monthlyNet,
    summaryRows,
    taxSchedule,
    goals,
    upcoming,
  };
}

// 7요인 값을 엮어 PB 종합 분석 문장 생성
function buildSummary(client: Client): string {
  const ips = client.ips;
  const t = CLIENT_TYPE_LABEL[client.clientType];
  const seg: string[] = [];
  seg.push(
    `${client.name} 고객은 ${t} 고객으로, 자산규모 ${formatKRW(client.assetSize)} 수준입니다.`,
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

function portfolioTypeOnlyLabel(portfolio: Client["portfolios"][number]): string {
  const id = portfolio.id.toLowerCase();
  if (id === "defensive" || id === "stable") return "방어형";
  if (id === "balanced") return "균형형";
  if (id === "growth" || id === "aggressive") return "성장형";

  const label = portfolio.label.trim();
  if (/방어|안정|defensive|stable/i.test(label)) return "방어형";
  if (/균형|balanced/i.test(label)) return "균형형";
  if (/성장|적극|공격|growth|aggressive/i.test(label)) return "성장형";

  return label
    .replace(/포트폴리오|추천안|추천|자산배분|도넛차트/gi, "")
    .trim() || label;
}

export default function IPSDocumentPage() {
  const { pbId, clientId } = useParams<{ pbId: string; clientId: string }>();
  const router = useRouter();
  const [client, setClient] = useState<Client | null>(null);
  const [pbs, setPbs] = useState<PB[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  const [pdfBlocked, setPdfBlocked] = useState(false);
  const [pdfReason, setPdfReason] = useState("");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const [c, allPbs] = await Promise.all([getClient(clientId), listPbs()]);
      if (!c) return setStatus("error");
      setClient(c);
      setPbs(allPbs);
      setStatus("ready");
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const bundle = loadBundle(clientId);
    setPdfBlocked(!canIssueClientPdf(bundle.status));
    setPdfReason(pdfBlockReason(bundle));
  }, [clientId]);
  if (status === "loading") return <LoadingView />;
  if (status === "error" || !client)
    return <ErrorView message="고객 정보를 불러올 수 없습니다." onRetry={load} />;

  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
  const pf = client.portfolios[0];
  const cashflowSummary = buildCashflowSummary(client.cashFlows);
  const confirmedWeights = pf
    ? buildPortfolioViewModel(client).portfolioOptions.find((option) => option.id === pf.id)?.weights
    : undefined;
  const displayAllocations = pf ? resolvePortfolioDisplayAllocations(pf, confirmedWeights) : [];
  const allocationChartData = displayAllocations.map((allocation) => ({
    name: allocation.assetClass,
    value: allocation.weight,
  }));
  const returnContributions = pf ? buildReturnContributionsFromPortfolio(displayAllocations, pf.expectedReturn) : [];
  const periodSeries = buildPeriodCashflowSeries(client.cashFlows);
  const evidence = loadBundle(clientId);
  const vmWeights = confirmedWeights ?? {
    etf: 30, bond: 25, els: 0, mmf: 30, gold: 10, dollar: 5, raw: 0,
  };
  const mergedTax = mergeTaxProfile(client);
  const taxWaterfall = projectTax({
    principalWon: client.assetSize,
    horizonYears: DEFAULT_HORIZON_YEARS,
    weights: vmWeights,
    expectedReturnPct: pf?.expectedReturn ?? 6,
    taxProfile: mergedTax.profile,
    cashFlows: client.cashFlows,
    cashflowTaxSummary: mergedTax.cashflowSummary,
    label: pf?.label ?? "기준안",
  });

  // 담당 PB 이름 (ID → 이름)
  const assignedPb = pbs.find((p) => p.id === client.assignedPbId);
  const pbDisplay = assignedPb ? assignedPb.name : "미지정";

  return (
    <div className="mx-auto max-w-3xl">
      {/* 상단 버튼 (인쇄 시 숨김) */}
      <div className="mb-4 flex items-center justify-between print:hidden">
        <button
          className="btn-outline text-sm"
          onClick={() => router.push(`/pb/${pbId}/${clientId}`)}
        >
          ← 고객 상세
        </button>
        <button
          className="btn-gold text-sm disabled:cursor-not-allowed disabled:opacity-50"
          disabled={pdfBlocked}
          onClick={() => {
            if (pdfBlocked) return;
            window.print();
          }}
        >
          {pdfBlocked ? "최종 PDF 비활성" : "🖨️ 인쇄 / PDF로 저장"}
        </button>
      </div>
      {pdfBlocked && (
        <p className="mb-3 text-xs font-semibold text-red-600 print:hidden">{pdfReason}</p>
      )}

      {/* ── 문서 본문 (항상 흰 배경·검은 글씨로 인쇄 친화) ── */}
      <div className="rounded-lg bg-white p-8 text-gray-900 shadow-card print:rounded-none print:p-0 print:shadow-none">
        {/* 헤더 */}
        <div className="border-b-2 border-gray-800 pb-4 text-center">
          <p className="text-xs font-semibold tracking-widest text-gray-500">
            SAMSUNG SECURITIES · PRIVATE BANKING
          </p>
          <h1 className="mt-1 text-2xl font-bold">투자정책서 (IPS)</h1>
          <p className="mt-1 text-xs text-gray-500">Investment Policy Statement</p>
        </div>

        <table className="mt-4 w-full text-sm">
          <tbody>
            <tr>
              <td className="w-24 py-1 text-gray-500">작성일</td>
              <td className="py-1 font-medium">{dateStr}</td>
              <td className="w-24 py-1 text-gray-500">문서번호</td>
              <td className="py-1 font-medium">IPS-{client.code}</td>
            </tr>
          </tbody>
        </table>

        {/* 1. 고객 기본정보 */}
        <Section title="1. 고객 기본정보">
          <InfoGrid
            rows={[
              ["고객명", client.name],
              ["구분", CLIENT_TYPE_LABEL[client.clientType]],
              ["식별코드", client.code],
              [
                client.clientType === "corporate" ? "설립일" : "생년월일",
                formatDate(client.birthDate),
              ],
              ["자산규모", formatKRW(client.assetSize)],
              ["담당 PB", pbDisplay],
              ["연동 고객 ID", client.linkedClientId ?? "없음"],
              [
                "지분/통장 상태",
                client.accountSeparation
                  ? ACCOUNT_SEPARATION_LABEL[client.accountSeparation]
                  : client.ownershipPct != null
                    ? `${client.ownershipPct}%${client.isMajorityShareholder ? " · 최대주주" : ""}`
                    : "미입력",
              ],
            ]}
          />
        </Section>

        {/* 2. 투자성향 분석 (RRTTLLU 7요인) */}
        <Section title="2. 투자성향 분석 (RRTTLLU 7요인)">
          {/* PB 종합 분석 의견 */}
          <div className="mb-3 rounded border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">
            <p className="mb-1 font-semibold text-gray-800">PB 종합 분석</p>
            {buildSummary(client)}
          </div>

          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-300 text-left text-gray-500">
                <th className="w-28 py-1.5 pr-2">요인</th>
                <th className="py-1.5 pr-2">값 / 설명</th>
              </tr>
            </thead>
            <tbody>
              {FACTOR_META.map((m) => {
                const f = client.ips[m.key];
                return (
                  <tr key={m.key} className="border-b border-gray-100 align-top">
                    <td className="py-1.5 pr-2 font-semibold">{m.label}</td>
                    <td className="py-1.5 pr-2">
                      {f.value || (
                        <span className="text-gray-400">
                          {f.status === "inferred" ? `참고: ${f.inferenceHint}` : "미언급"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>

        {/* 3. 현금흐름 요약 및 세금 납부 일정 */}
        <Section title="3. 현금흐름 요약 및 세금 납부 일정">
          {client.cashFlows.length === 0 ? (
            <p className="text-xs text-gray-400">등록된 현금흐름이 없습니다.</p>
          ) : (
            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <MetricCard label="월 총소득" value={formatManwon(cashflowSummary.recurringIn)} />
                <MetricCard label="월 총지출" value={formatManwon(cashflowSummary.recurringOut)} tone="danger" />
                <MetricCard
                  label="월 순현금흐름"
                  value={formatManwon(cashflowSummary.monthlyNet)}
                  tone={cashflowSummary.monthlyNet < 0 ? "danger" : "normal"}
                />
                <MetricCard label="현재 현금성자산" value={formatManwon(cashflowSummary.currentCashWon)} />
              </div>

              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-gray-300 text-left text-gray-500">
                    <th className="py-1.5">구분</th>
                    <th className="py-1.5">항목</th>
                    <th className="py-1.5 text-right">월/연 금액(만원)</th>
                  </tr>
                </thead>
                <tbody>
                  {cashflowSummary.summaryRows.map((row) => (
                    <tr key={row.group} className="border-b border-gray-100">
                      <td className="py-1.5 font-semibold">{row.group}</td>
                      <td className="py-1.5 text-gray-600">{row.item}</td>
                      <td className={`py-1.5 text-right font-medium ${row.annualizedAmount < 0 ? "text-red-600" : "text-gray-900"}`}>
                        {row.annualizedAmount < 0 ? "−" : "+"}
                        {formatManwon(Math.abs(row.annualizedAmount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="rounded border border-gray-200 bg-gray-50 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-gray-800">고액자산가 세금 납부 및 현금화 일정</p>
                  <TaxReadinessRubricButton
                    label="준비상태 기준표"
                    className="rounded border border-gray-300 bg-white px-2 py-0.5 text-[10px] font-bold text-gray-500 hover:border-gray-600 hover:text-gray-900 print:hidden"
                  />
                </div>
                {cashflowSummary.taxSchedule.length === 0 ? (
                  <p className="text-gray-400">세금성 이벤트가 입력되지 않았습니다.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-gray-500">
                        <th className="py-1">세금/이벤트</th>
                        <th className="py-1 text-right">예상세액(만원)</th>
                        <th className="py-1">납부기한</th>
                        <th className="py-1">현금화 목표일</th>
                        <th className="py-1 text-center">준비상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cashflowSummary.taxSchedule.map((event) => (
                        <tr key={event.id} className="border-b border-gray-200 last:border-0">
                          <td className="py-1">
                            <p className="font-medium">{event.label}</p>
                            <p className="mt-0.5 max-w-[300px] text-[10px] leading-snug text-gray-500">
                              {event.readiness.reason}
                            </p>
                          </td>
                          <td className="py-1 text-right font-medium">{formatManwon(event.amountWon)}</td>
                          <td className="py-1 text-gray-500">{event.dueDate}</td>
                          <td className="py-1 text-gray-500">{event.cashReadyDate}</td>
                          <td className="py-1 text-center">
                            <StatusBadge status={event.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="rounded border border-gray-200 p-3">
                  <p className="mb-2 font-semibold text-gray-800">재무목표</p>
                  <table className="w-full">
                    <tbody>
                      {(cashflowSummary.goals.length ? cashflowSummary.goals : [{ goal: "현금화 목표 미입력", targetDate: "미정", amount: 0, priority: "점검", note: "상담 시 목표금액/시점 확인" }]).map((goal) => (
                        <tr key={`${goal.goal}-${goal.targetDate}`} className="border-b border-gray-100 last:border-0">
                          <td className="py-1">
                            <b>{goal.goal}</b>
                            <span className="ml-2 text-gray-400">{goal.targetDate}</span>
                          </td>
                          <td className="py-1 text-right">
                            {formatManwon(goal.amount)}
                            <span className="ml-2 text-gray-400">{goal.priority}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="rounded border border-gray-200 p-3">
                  <p className="mb-2 font-semibold text-gray-800">주요 현금흐름 일정</p>
                  <table className="w-full">
                    <tbody>
                      {cashflowSummary.upcoming.map((flow) => (
                        <tr key={flow.id} className="border-b border-gray-100 last:border-0">
                          <td className="py-1 text-gray-500">{flow.date || "시점 미정"}</td>
                          <td className="py-1">{flow.label || "(항목)"}</td>
                          <td className={`py-1 text-right font-medium ${flow.amount < 0 ? "text-red-600" : "text-gray-900"}`}>
                            {flow.amount < 0 ? "−" : "+"}
                            {formatManwon(Math.abs(flow.amount))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <p className="text-[10px] text-gray-400">
                ※ 현금흐름은 상담 입력 기준의 추정치입니다. 세금·비용처리·법인/개인 자금 이동은 세무 전문가 확인이 필요합니다.
              </p>
            </div>
          )}
        </Section>

        {/* 4. 확정 포트폴리오 */}
        <Section title="4. 확정 포트폴리오">
          {!pf ? (
            <p className="text-xs text-gray-400">
              확정된 포트폴리오가 없습니다. (포트폴리오 단계에서 최종 확정 필요)
            </p>
          ) : (
            <div>
              <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                <span>
                  <b>유형</b> {pf.label}
                </span>
                <span>
                  <b>예상수익률</b> {pf.expectedReturn}%
                </span>
                <span>
                  <b>예상변동성</b> {pf.expectedRisk}%
                </span>
              </div>
              <p className="mb-3 text-[10px] leading-relaxed text-gray-500">
                수익률은 시장 proxy 연결 전 fallback 기반 참고 추정치이며, 미래 성과 또는 벤치마크 초과수익을 의미하지 않습니다.
              </p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded border border-gray-200 p-3">
                  <p className="mb-2 text-xs font-semibold text-gray-700">{portfolioTypeOnlyLabel(pf)}</p>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={allocationChartData}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={46}
                          outerRadius={76}
                          paddingAngle={2}
                        >
                          {allocationChartData.map((entry, index) => (
                            <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(value: unknown) => `${Number(value).toFixed(1)}%`} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1 text-[10px]">
                    {allocationChartData.map((entry, index) => (
                      <div key={entry.name} className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }} />
                        <span className="text-gray-600">
                          {entry.name} {entry.value}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded border border-gray-200 p-3">
                  <p className="mb-2 text-xs font-semibold text-gray-700">자산군별 수익률 기여도</p>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={returnContributions} layout="vertical" margin={{ top: 4, right: 28, bottom: 0, left: 8 }}>
                        <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" horizontal={false} />
                        <XAxis type="number" unit="%p" tick={{ fontSize: 9, fill: "#6b7280" }} />
                        <YAxis type="category" dataKey="name" width={64} tick={{ fontSize: 9, fill: "#6b7280" }} />
                        <Tooltip formatter={(value: unknown) => `${Number(value).toFixed(2)}%p`} />
                        <Bar dataKey="contributionPct" name="기여도" radius={[0, 3, 3, 0]}>
                          {returnContributions.map((entry, index) => (
                            <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-0.5 text-[10px]">
                    {returnContributions.map((c) => (
                      <div key={c.name} className="flex items-center justify-between text-gray-600">
                        <span>{c.name}</span>
                        <span>
                          {c.weightPct}% × {c.appliedReturnPct}% ={" "}
                          <b className="text-gray-800">{c.contributionPct}%p</b>
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-gray-400">
                    각 자산군 비중 × 적용 연수익률의 기여도이며, 합계는 예상수익률 {pf.expectedReturn}%와 일치합니다. 시장 proxy 기반 참고치로 미래 성과를 보장하지 않습니다.
                  </p>
                </div>
              </div>
              <table className="mt-3 w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-300 text-left text-gray-500">
                    <th className="py-1.5">자산군</th>
                    <th className="py-1.5 text-right">비중</th>
                  </tr>
                </thead>
                <tbody>
                  {displayAllocations.map((a, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="py-1.5">{a.assetClass}</td>
                      <td className="py-1.5 text-right font-medium">{a.weight}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pf.taxNote && <p className="mt-2 text-xs text-gray-600">세금: {pf.taxNote}</p>}
              {pf.rationale && (
                <p className="mt-1 text-xs leading-relaxed text-gray-600">근거: {pf.rationale}</p>
              )}
            </div>
          )}
        </Section>

        {periodSeries.length >= 2 && (
          <Section title="부록. 기간별 현금흐름 추이">
            <div className="space-y-3 text-xs">
              <div className="rounded border border-gray-200 p-3">
                <p className="mb-1 font-semibold text-gray-800">기간별 현금흐름 추이</p>
                <p className="mb-2 text-[10px] text-gray-500">유입·유출·저축·세금·순현금흐름 (만원)</p>
                <PeriodCashflowLineChart series={periodSeries} className="h-80" />
              </div>
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-gray-300 text-left text-gray-500">
                    <th className="py-1.5">기간</th>
                    <th className="py-1.5 text-right">유입</th>
                    <th className="py-1.5 text-right">유출</th>
                    <th className="py-1.5 text-right">저축/투자</th>
                    <th className="py-1.5 text-right">세금</th>
                    <th className="py-1.5 text-right">순현금흐름</th>
                    <th className="py-1.5 text-right">누적</th>
                  </tr>
                </thead>
                <tbody>
                  {periodSeries.map((point) => (
                    <tr key={point.period} className="border-b border-gray-100">
                      <td className="py-1.5 font-semibold">{point.period}</td>
                      <td className="py-1.5 text-right">{formatManwon(point.incomeWon)}</td>
                      <td className="py-1.5 text-right text-red-600">{formatManwon(point.outflowWon)}</td>
                      <td className="py-1.5 text-right">{formatManwon(point.savingWon)}</td>
                      <td className="py-1.5 text-right">{formatManwon(point.taxWon)}</td>
                      <td className={`py-1.5 text-right font-medium ${point.netWon < 0 ? "text-red-600" : "text-gray-900"}`}>
                        {formatManwon(point.netWon)}
                      </td>
                      <td className={`py-1.5 text-right font-medium ${point.cumulativeNetWon < 0 ? "text-red-600" : "text-gray-900"}`}>
                        {formatManwon(point.cumulativeNetWon)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-gray-400">
                ※ 이 부록은 XLSX의 부록_기간별현금흐름 시트와 메인 세금일정의 납부월 데이터를 기반으로 표시됩니다.
              </p>
            </div>
          </Section>
        )}

        <Section title="세후 결과 워터폴 (결정론 엔진)">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="py-1.5">세전 기말자산</td>
                <td className="py-1.5 text-right font-semibold">{formatKRW(taxWaterfall.principalWon + taxWaterfall.grossReturnWon)}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-1.5">예상 세금</td>
                <td className="py-1.5 text-right">−{formatKRW(taxWaterfall.taxes.totalTaxWon)}</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-1.5">상품/거래 비용</td>
                <td className="py-1.5 text-right">−{formatKRW(taxWaterfall.feesWon)}</td>
              </tr>
              <tr>
                <td className="py-1.5 font-bold">세후 기말자산</td>
                <td className="py-1.5 text-right font-bold">{formatKRW(taxWaterfall.netEndingWon)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-1 text-[10px] text-gray-500">
            as-of {dateStr} · source deterministic-engine · KRW · {taxWaterfall.assumptions[0]}
          </p>
        </Section>

        <Section title="재현성 해시 / Evidence">
          <p className="text-[11px] text-gray-600">{AI_ROLE_COPY}</p>
          <p className="mt-1 font-mono text-[10px] break-all">inputHash {evidence.inputHash || "—"}</p>
          <p className="font-mono text-[10px] break-all">settingsHash {evidence.settingsHash || "—"}</p>
          <p className="font-mono text-[10px] break-all">resultHash {evidence.resultHash || evidence.outputHash || "—"}</p>
          <p className="mt-1 text-[10px] text-gray-500">상태 {evidence.status} · runId {evidence.runId}</p>
        </Section>

        {/* 디스클레이머 */}
        <div className="mt-6 rounded border border-gray-300 bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-600">
          ※ 본 투자정책서는 PB 상담 내용을 구조화한 <b>참고용 문서</b>이며 투자 권유가 아닙니다.
          포트폴리오·스트레스 결과는 통계적 추정치로 미래 수익을 보장하지 않으며, 실제 투자 결정 및
          {HONESTY_LIMITS.map((line) => (
            <span key={line}> {line}</span>
          ))}
        </div>

        {/* 서명란 */}
        <div className="mt-8 grid grid-cols-2 gap-8 text-sm">
          <div>
            <p className="mb-8 text-gray-500">담당 PB</p>
            <div className="border-t border-gray-400 pt-1 text-center text-xs text-gray-500">
              (서명)
            </div>
          </div>
          <div>
            <p className="mb-8 text-gray-500">고객</p>
            <div className="border-t border-gray-400 pt-1 text-center text-xs text-gray-500">
              {client.name} (서명)
            </div>
          </div>
        </div>

        <p className="mt-6 text-center text-[10px] text-gray-400">
          삼성증권 PB센터 · {dateStr} 생성
        </p>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-6">
      <h2 className="mb-2 border-l-4 border-gray-800 pl-2 text-base font-bold">{title}</h2>
      {children}
    </div>
  );
}

function InfoGrid({ rows }: { rows: [string, string][] }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([k, v], i) =>
          i % 2 === 0 ? (
            <tr key={i} className="border-b border-gray-100">
              <td className="w-28 py-1.5 text-gray-500">{rows[i][0]}</td>
              <td className="py-1.5 font-medium">{rows[i][1]}</td>
              <td className="w-28 py-1.5 text-gray-500">{rows[i + 1]?.[0] ?? ""}</td>
              <td className="py-1.5 font-medium">{rows[i + 1]?.[1] ?? ""}</td>
            </tr>
          ) : null,
        )}
      </tbody>
    </table>
  );
}

function MetricCard({
  label,
  value,
  tone = "normal",
}: {
  label: string;
  value: string;
  tone?: "normal" | "danger";
}) {
  return (
    <div className="rounded border border-gray-200 bg-gray-50 px-3 py-2">
      <p className="text-[10px] font-semibold text-gray-500">{label}</p>
      <p className={`mt-1 text-sm font-bold ${tone === "danger" ? "text-red-600" : "text-gray-900"}`}>
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
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold ${cls}`}>{label}</span>;
}
