"use client";

/**
 * 고객 대면 화면 — /client/[clientId] 와 PB 상세 「고객화면」 탭에서 공용.
 * 라이브 동기화된 현재 상담본을 보여 주며, 발행된 IPS/PDF 스냅샷과는 분리된다.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { Client } from "@/lib/types";
import { CLIENT_TYPE_LABEL, computeStages } from "@/lib/types";
import { formatKRW, formatDate } from "@/lib/format";
import { formatPercent1 } from "@/lib/formatPercent";
import IPSRadar from "@/components/IPSRadar";
import IPSSummary from "@/components/IPSSummary";
import { useLiveClient } from "@/hooks/useLiveClient";
import { buildCustomerViewSummary } from "@/lib/customerViewSummary";
import {
  isIpsWorkflowApproved,
  isPortfolioWorkflowApproved,
} from "@/lib/advisory/workflowApprovals";
import type { ManualPortfolioDraft } from "@/lib/manualPortfolioDraft";

const CHART_COLORS = ["#1428A0", "#2C3EE8", "#64748B", "#0F172A", "#94A3B8", "#334155"];

interface Props {
  /** 임베드 시 부모가 가진 최신 Client (즉시 반영) */
  client?: Client | null;
  clientId?: string;
  pbId?: string | null;
  embedded?: boolean;
  investableWon?: number | null;
  /** 부모가 이미 로드한 초안(없으면 훅이 조회) */
  draft?: ManualPortfolioDraft | null;
  /** false 이면 외부 공유용 — 포트폴리오 미승인 시 잠금 유지 */
  allowPreviewWithoutPortfolioApproval?: boolean;
}

export default function ClientFacingView({
  client: seedClient = null,
  clientId: clientIdProp,
  pbId = null,
  embedded = false,
  investableWon: seedInvestable = null,
  draft: seedDraft = null,
  allowPreviewWithoutPortfolioApproval,
}: Props) {
  const router = useRouter();
  const clientId = clientIdProp ?? seedClient?.id ?? "";
  const resolvedPbId = pbId ?? seedClient?.assignedPbId ?? null;
  const allowPreview =
    allowPreviewWithoutPortfolioApproval ?? embedded;

  const live = useLiveClient(clientId, {
    pbId: resolvedPbId,
    initialClient: seedClient,
    initialInvestableWon: seedInvestable,
    enablePolling: true,
    pollMs: 15_000,
  });

  const client = live.client ?? seedClient;
  const investableWon = live.investableWon ?? seedInvestable;
  const draft = live.draft ?? seedDraft;

  const summary = useMemo(() => {
    if (!client) return null;
    return buildCustomerViewSummary({ client, investableWon, draft });
  }, [client, investableWon, draft]);

  const [cashOpen, setCashOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  if (!clientId) {
    return (
      <div className="rounded-lg border border-border bg-white p-8 text-center text-sm text-fg-muted">
        고객을 선택해 주세요.
      </div>
    );
  }

  if ((live.status === "loading" || live.status === "switching") && !client) {
    return (
      <div className="rounded-lg border border-border bg-white p-8 text-center text-sm text-fg-muted">
        고객 정보를 불러오는 중…
      </div>
    );
  }

  if ((live.status === "error" || !client) && !seedClient) {
    return (
      <div className="rounded-lg border border-red-200 bg-white p-8 text-center">
        <p className="text-sm font-semibold text-red-700">
          {live.errorMessage || "고객 정보를 불러올 수 없습니다."}
        </p>
        <button type="button" className="btn-outline mt-3 text-sm" onClick={() => void live.reload()}>
          다시 시도
        </button>
      </div>
    );
  }

  if (!client || !summary) return null;

  const portfolioReady = isPortfolioWorkflowApproved(client);
  const ipsReady = isIpsWorkflowApproved(client);

  // 기본정보 미승인 게이트는 두지 않는다. 승인 전에도 PB 탭에서 화면을 띄울 수 있어야
  // 회의를 바로 시작할 수 있고, 승인된 내용이 없으면 각 섹션이 알아서 비어 보인다.
  // 아래 포트폴리오 게이트는 allowPreview=false 인 외부 공유 라우트(/client/[clientId])
  // 전용으로 남긴다 — 그쪽은 로그인 가드가 없어 게이트를 낮추면 인증 없이 노출된다.
  if (!portfolioReady && !allowPreview) {
    return (
      <div className="rounded-lg border border-border bg-white p-8 text-center">
        <p className="text-sm font-bold text-fg">
          고객화면을 표시하려면 포트폴리오 승인이 필요합니다.
        </p>
      </div>
    );
  }

  const done = computeStages(client);
  const has7Factor =
    done.factors || Object.values(client.ips ?? {}).some((f) => (f?.value || "").trim());
  const hasCashFlow = (client.cashFlows?.length ?? 0) > 0;
  const allocationChartData = summary.allocations.map((a) => ({
    name: a.assetClass,
    value: a.weight,
  }));
  const instrumentRows =
    summary.instruments.length > 0 ? summary.instruments : summary.proposedInstruments;
  const showingProposedOnly =
    summary.instruments.length === 0 && summary.proposedInstruments.length > 0;

  const goPb = () =>
    router.push(client.assignedPbId ? `/pb/${client.assignedPbId}/${client.id}` : `/`);

  const reviewTone =
    summary.reviewStatus === "needs_review"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : summary.reviewStatus === "ips_ready"
        ? "border-[#DCE4F5] bg-[#F0F3FA] text-[#1428A0]"
        : "border-border bg-surface-2 text-fg";

  return (
    <div className="space-y-4 text-[#0F172A]">
      {/* 상단 바 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-[#1428A0] px-2 py-0.5 text-[11px] font-bold text-white">
            고객화면
          </span>
          <span className={`rounded border px-2 py-0.5 text-[11px] font-semibold ${reviewTone}`}>
            {summary.reviewLabelKo}
          </span>
          {live.refreshing && (
            <span className="text-[11px] text-fg-muted">동기화 중…</span>
          )}
          {live.syncHint && !live.refreshing && (
            <span className="text-[11px] text-fg-muted">{live.syncHint}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn-outline text-xs"
            onClick={() => void live.reload()}
            disabled={live.refreshing}
          >
            새로고침
          </button>
          {!embedded && (
            <button type="button" className="btn-primary text-xs" onClick={goPb}>
              PB 화면 →
            </button>
          )}
        </div>
      </div>

      {/* 헤더: 신원 + 목표 + 상태 */}
      <header className="border-b border-[#E2E8F0] pb-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium text-[#64748B]">{client.code}</p>
            <h1 className="text-2xl font-bold tracking-tight text-[#0F172A] sm:text-[28px]">
              {client.name}
              <span className="ml-1 text-base font-semibold text-[#64748B]">님</span>
            </h1>
            <p className="mt-1 text-xs text-[#64748B]">
              {CLIENT_TYPE_LABEL[client.clientType]} ·{" "}
              {client.clientType === "corporate" ? "설립일" : "생년월일"}{" "}
              {formatDate(client.birthDate)}
            </p>
          </div>
          <p className="max-w-md text-right text-[11px] leading-snug text-[#64748B]">
            상담 참고용 요약입니다. 투자 권유가 아니며, 발행된 IPS/PDF와는 별개의 현재 상담본입니다.
          </p>
        </div>
      </header>

      {/* KPI */}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi
          label="투자가능자산(AUM)"
          value={formatKRW(investableWon ?? client.assetSize)}
        />
        <Kpi
          label="구성 배정 합계"
          value={
            summary.portfolioValueWon == null
              ? "—"
              : formatKRW(summary.portfolioValueWon)
          }
          note={
            summary.portfolioValueWon == null
              ? undefined
              : summary.portfolioValueComplete
                ? "승인 구성 기준"
                : "일부 금액 미확정"
          }
        />
        <Kpi label="예상 수익" value={summary.expectedReturnPct == null ? "산출 전" : formatPercent1(summary.expectedReturnPct)} />
        <Kpi
          label="월 순현금흐름"
          value={
            summary.cashflowMonthlyNetWon == null
              ? "—"
              : `${summary.cashflowMonthlyNetWon < 0 ? "−" : ""}${formatKRW(Math.abs(summary.cashflowMonthlyNetWon))}`
          }
          danger={!!summary.cashflowMonthlyNetWon && summary.cashflowMonthlyNetWon < 0}
        />
      </section>

      {/* 포트폴리오 구성 — 1뷰포트 핵심 */}
      <section className="rounded-lg border border-[#E2E8F0] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E2E8F0] px-3 py-2">
          <div>
            <h2 className="text-sm font-bold text-[#0F172A]">포트폴리오 구성</h2>
            <p className="text-[11px] text-[#64748B]">
              {summary.portfolioLabel ?? "맞춤 포트폴리오"}
              {showingProposedOnly ? " · 제안(미승인)" : " · 현재 저장본"}
              {" · "}
              {summary.metricsLabelKo}
            </p>
          </div>
          {summary.legacyIncomplete && (
            <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
              종목 상세 확인 필요
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_140px]">
          <div className="overflow-x-auto">
            {instrumentRows.length === 0 ? (
              <p className="py-6 text-center text-xs text-[#64748B]">
                {summary.allocations.length
                  ? "자산군 비중만 있습니다. 편입 종목은 포트폴리오 재승인 후 표시됩니다."
                  : "표시할 구성이 없습니다."}
              </p>
            ) : (
              <table className="w-full min-w-[520px] border-collapse text-xs">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wide text-[#64748B]">
                    <th className="pb-1.5 font-semibold">종목</th>
                    <th className="pb-1.5 font-semibold">자산군</th>
                    <th className="pb-1.5 text-right font-semibold">군내</th>
                    <th className="pb-1.5 text-right font-semibold">전체</th>
                    <th className="pb-1.5 text-right font-semibold">배정</th>
                    <th className="pb-1.5 text-right font-semibold">수량</th>
                  </tr>
                </thead>
                <tbody>
                  {instrumentRows.map((row) => (
                    <tr key={`${row.source}-${row.symbol}`} className="border-t border-[#F1F5F9]">
                      <td className="py-1.5 pr-2">
                        <span className="font-semibold">{row.name}</span>
                        <span className="ml-1 text-[10px] text-[#94A3B8]">{row.symbol}</span>
                      </td>
                      <td className="py-1.5 text-[#475569]">{row.assetClassLabel}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {formatPercent1(row.weightWithinClass)}
                      </td>
                      <td className="py-1.5 text-right font-semibold tabular-nums">
                        {formatPercent1(row.totalWeightPct)}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {row.allocationAmountWon != null
                          ? formatKRW(row.allocationAmountWon)
                          : "—"}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">
                        {row.quantity != null ? row.quantity.toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="mt-2 text-[10px] leading-snug text-[#94A3B8]">
              위 수량·배정은 상담 구성(장부) 기준이며 증권사 주문·체결 내역이 아닙니다.
            </p>
          </div>

          <div className="flex flex-col items-center">
            <p className="mb-1 text-[10px] font-semibold text-[#64748B]">자산군 비중</p>
            {allocationChartData.length > 0 ? (
              <>
                <div className="h-[112px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={allocationChartData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={28}
                        outerRadius={48}
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
                      <Tooltip formatter={(v: unknown) => formatPercent1(Number(v))} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="mt-1 w-full space-y-0.5 text-[10px] text-[#475569]">
                  {allocationChartData.map((entry, index) => (
                    <li key={entry.name} className="flex items-center justify-between gap-1">
                      <span className="flex min-w-0 items-center gap-1 truncate">
                        <span
                          className="inline-block h-1.5 w-1.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                        />
                        {entry.name}
                      </span>
                      <span className="tabular-nums">{formatPercent1(entry.value)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="py-6 text-[10px] text-[#94A3B8]">비중 없음</p>
            )}
          </div>
        </div>

        {summary.hasProposedDiff && (
          <div className="border-t border-dashed border-amber-200 bg-amber-50/60 px-3 py-2">
            <p className="text-[11px] font-semibold text-amber-900">
              미승인 제안 초안이 있습니다 (저장본과 다름)
            </p>
            <p className="mt-0.5 text-[10px] text-amber-800">
              아래는 초안 종목이며, 승인·확정된 보유가 아닙니다.
            </p>
            <ul className="mt-1 columns-1 gap-x-4 text-[10px] text-amber-950 sm:columns-2">
              {summary.proposedInstruments.map((row) => (
                <li key={`p-${row.symbol}`} className="break-inside-avoid py-0.5">
                  {row.name} ({row.symbol}) · 전체 {formatPercent1(row.totalWeightPct)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* 투자성향 — 접이식 */}
      <section className="rounded-lg border border-[#E2E8F0] bg-white">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-left"
          onClick={() => setProfileOpen((v) => !v)}
        >
          <h2 className="text-sm font-bold">투자 목적 · 성향</h2>
          <span className="text-[11px] text-[#64748B]">{profileOpen ? "접기" : "펼치기"}</span>
        </button>
        {profileOpen && (
          <div className="border-t border-[#E2E8F0] px-3 py-3">
            {has7Factor ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <IPSRadar ips={client.ips} height={220} lang="ko" />
                <IPSSummary ips={client.ips} lang="ko" />
              </div>
            ) : (
              <p className="text-xs text-[#64748B]">투자성향(7요인)이 아직 정리되지 않았습니다.</p>
            )}
          </div>
        )}
      </section>

      {/* 현금흐름 */}
      <section className="rounded-lg border border-[#E2E8F0] bg-white">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-left"
          onClick={() => setCashOpen((v) => !v)}
        >
          <h2 className="text-sm font-bold">현금흐름 · 유동성</h2>
          <span className="text-[11px] text-[#64748B]">
            {hasCashFlow
              ? cashOpen
                ? "접기"
                : `요약 ${summary.cashflowMonthlyNetWon != null ? formatKRW(summary.cashflowMonthlyNetWon) : ""} · 펼치기`
              : "없음"}
          </span>
        </button>
        {cashOpen && hasCashFlow && (
          <div className="divide-y divide-[#F1F5F9] border-t border-[#E2E8F0]">
            {client.cashFlows.slice(0, 12).map((cf) => (
              <div
                key={cf.id}
                className="flex items-center justify-between px-3 py-2 text-xs"
              >
                <span>
                  {cf.label || "(항목)"}
                  <span className="ml-2 text-[10px] text-[#94A3B8]">
                    {cf.date || "시점 미정"}
                    {cf.recurring ? " · 정기" : ""}
                  </span>
                </span>
                <span
                  className={`font-semibold tabular-nums ${
                    cf.amount < 0 ? "text-red-600" : "text-[#1428A0]"
                  }`}
                >
                  {cf.amount < 0 ? "−" : "+"}
                  {formatKRW(Math.abs(cf.amount))}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 세금 메모 */}
      {(client.portfolios[0]?.taxNote || client.financialIncomeComprehensiveTax != null) && (
        <section className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-2">
          <h2 className="text-sm font-bold">세금 요약</h2>
          <p className="mt-1 text-xs text-[#475569]">
            {client.financialIncomeComprehensiveTax
              ? "금융소득 종합과세 대상 정보가 입력되어 있습니다."
              : "금융소득 종합과세: 해당 없음/미해당으로 기록됨."}
          </p>
          {client.portfolios[0]?.taxNote?.trim() && (
            <p className="mt-1 text-xs text-[#64748B]">{client.portfolios[0].taxNote}</p>
          )}
        </section>
      )}

      {ipsReady && (
        <p className="rounded border border-[#DCE4F5] bg-[#F0F3FA] px-3 py-2 text-[11px] text-[#1428A0]">
          IPS가 확정되어 있습니다. 최종 PDF는 승인 시점 스냅샷이며, 이 화면의 이후 수정과
          자동으로 바뀌지 않습니다.
        </p>
      )}

      {!portfolioReady && allowPreview && (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          포트폴리오 미승인 상태의. 표시 내용은 현재 저장본이며 최종 확정이 아닙니다.
        </p>
      )}

      {!embedded && (
        <div className="text-center">
          <button type="button" className="btn-outline text-sm" onClick={goPb}>
            ← PB 화면으로
          </button>
        </div>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  note,
  danger,
}: {
  label: string;
  value: string;
  note?: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-2">
      <p className="text-[10px] font-semibold text-[#64748B]">{label}</p>
      <p
        className={`mt-0.5 text-sm font-bold tabular-nums sm:text-base ${
          danger ? "text-red-600" : "text-[#0F172A]"
        }`}
      >
        {value}
      </p>
      {note && <p className="mt-0.5 text-[9px] text-[#94A3B8]">{note}</p>}
    </div>
  );
}
