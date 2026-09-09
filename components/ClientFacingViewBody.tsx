"use client";

/**
 * 고객 대면 화면 — 렌더 전용. 데이터를 스스로 읽지 않는다.
 *
 * ClientFacingView(PB 탭)와 공유 링크(/view/[token])가 같은 화면을 그리되 데이터를
 * 얻는 경로는 다르다. 앞은 useLiveClient 로 anon 조회 + 라이브 동기화, 뒤는 서버가
 * service_role 로 조립한 payload 를 props 로 받는다. 그 차이를 이 파일 밖으로 밀어내
 * 화면 코드가 한 벌만 남게 한다.
 *
 * 이 파일이 lib/store·lib/supabase 를 import 하지 않는 것이 중요하다. 공유 링크
 * 페이지의 청크가 그 그래프를 타지 않으면 NEXT_PUBLIC_SUPABASE_ANON_KEY 가 그 번들에
 * 인라인되지 않는다(Next 는 키를 참조하는 청크에만 값을 심는다).
 * ⚠️ 공유 청크로 새어 나갈 수 있으므로, 빌드 후 .next/static 에서 키 문자열을 grep 해
 *    실제로 빠졌는지 확인해야 한다 — 확인 전까지는 "빠질 수 있다"까지만 사실이다.
 */

import { useState } from "react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import { CLIENT_TYPE_LABEL } from "@/lib/types";
import { formatKRW, formatDate } from "@/lib/format";
import { formatPercent1 } from "@/lib/formatPercent";
import IPSSummary from "@/components/IPSSummary";
import type { ClientViewPayload } from "@/lib/clientView/types";

const CHART_COLORS = ["#1428A0", "#2C3EE8", "#64748B", "#0F172A", "#94A3B8", "#334155"];

/** 라이브 동기화 표시·조작. PB 탭에서만 넘어온다 — 공유 링크에는 동기화가 없다. */
export interface ClientFacingViewLive {
  refreshing: boolean;
  syncHint: string | null;
  onReload: () => void;
}

interface Props {
  view: ClientViewPayload;
  live?: ClientFacingViewLive;
  /** PB 화면으로 돌아가는 동작. 없으면 그 버튼을 아예 그리지 않는다(공유 링크). */
  onGoPb?: () => void;
}

// 표시 정책은 어디서 열든 하나다 — 섹션마다 자기 승인 상태를 따른다.
// 예전에는 외부 공유 화면용 "통째 잠금"(lockWithoutPortfolioApproval)이 따로 있었다.
// /client/[clientId] 에 인증이 아예 없어서 미승인 내용이 인증 없이 노출되는 걸 막던
// 장치였는데, 그 라우트와 /view/[token] 이 모두 서명 토큰을 요구하게 되면서 근거가
// 사라졌다. 같은 고객이 어느 URL 형태를 받았느냐에 따라 다른 내용을 보게 되므로 걷어낸다.
export default function ClientFacingViewBody({ view, live, onGoPb }: Props) {
  const [cashOpen, setCashOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);

  const { profile, gates, summary } = view;
  const { basicReady, portfolioReady, ipsReady } = gates;

  // 기본정보가 미승인이면 본문 전체를 가린다. 이 상태에서는 포트폴리오도 캐스케이드로
  // 풀려 있어 보여 줄 수 있는 섹션이 하나도 없다 — 빈 껍데기 여러 장 대신 안내 한 장.
  if (!basicReady) {
    return (
      <div className="rounded-lg border border-border bg-white p-8 text-center">
        <p className="text-sm font-bold text-fg">기본정보 승인이 필요합니다.</p>
        <p className="mt-1 text-xs text-fg-muted">
          승인하면 이 화면에 내용이 바로 표시됩니다.
        </p>
        {/* 어느 고객의 화면인지 밝힌다. 본인이 보는 화면이라 자기 코드·이름은 새 정보가
            아니고, PB 가 링크를 잘못 만들었을 때 이 한 줄로 바로 드러난다 —
            안내만 뜨는 화면은 그 사실을 확인할 방법이 달리 없었다. */}
        <p className="mt-4 text-[11px] text-[#94A3B8]">
          {profile.name} 님 · {profile.code}
        </p>
      </div>
    );
  }

  const has7Factor =
    gates.factorsApproved || Object.values(view.ips ?? {}).some((f) => (f?.value || "").trim());
  const hasCashFlow = view.cashFlows.length > 0;
  const allocationChartData = summary.allocations.map((a) => ({
    name: a.assetClass,
    value: a.weight,
  }));
  const instrumentRows =
    summary.instruments.length > 0 ? summary.instruments : summary.proposedInstruments;
  const showingProposedOnly =
    summary.instruments.length === 0 && summary.proposedInstruments.length > 0;

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
          {live?.refreshing && (
            <span className="text-[11px] text-fg-muted">동기화 중…</span>
          )}
          {live?.syncHint && !live.refreshing && (
            <span className="text-[11px] text-fg-muted">{live.syncHint}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* 공유 링크에는 라이브 동기화가 없다 — 새로고침 버튼도 함께 빠진다.
              (브라우저 새로고침으로 서버에서 다시 받으면 되고, 그게 정확하다.) */}
          {live && (
            <button
              type="button"
              className="btn-outline text-xs"
              onClick={() => void live.onReload()}
              disabled={live.refreshing}
            >
              새로고침
            </button>
          )}
          {onGoPb && (
            <button type="button" className="btn-primary text-xs" onClick={onGoPb}>
              PB 화면 →
            </button>
          )}
        </div>
      </div>

      {/* 헤더: 신원 + 목표 + 상태 */}
      <header className="border-b border-[#E2E8F0] pb-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium text-[#64748B]">{profile.code}</p>
            <h1 className="text-2xl font-bold tracking-tight text-[#0F172A] sm:text-[28px]">
              {profile.name}
              <span className="ml-1 text-base font-semibold text-[#64748B]">님</span>
            </h1>
            <p className="mt-1 text-xs text-[#64748B]">
              {CLIENT_TYPE_LABEL[profile.clientType]} ·{" "}
              {profile.clientType === "corporate" ? "설립일" : "생년월일"}{" "}
              {formatDate(profile.birthDate)}
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
          value={formatKRW(view.investableWon)}
        />
        {/* 아래 둘은 포트폴리오 승인의 산출물이다. 미승인이면 칸은 남기고 값만 바꾼다 —
            칸을 빼면 4열 그리드가 무너지고, 무엇이 빠졌는지도 보이지 않는다. */}
        <Kpi
          label="구성 배정 합계"
          value={
            !portfolioReady
              ? "승인 후 표시"
              : summary.portfolioValueWon == null
                ? "—"
                : formatKRW(summary.portfolioValueWon)
          }
          note={
            !portfolioReady || summary.portfolioValueWon == null
              ? undefined
              : summary.portfolioValueComplete
                ? "승인 구성 기준"
                : "일부 금액 미확정"
          }
          muted={!portfolioReady}
        />
        <Kpi
          label="예상 수익"
          value={
            !portfolioReady
              ? "승인 후 표시"
              : summary.expectedReturnPct == null
                ? "산출 전"
                : formatPercent1(summary.expectedReturnPct)
          }
          muted={!portfolioReady}
        />
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
            {portfolioReady && (
              <p className="text-[11px] text-[#64748B]">
                {summary.portfolioLabel ?? "맞춤 포트폴리오"}
                {showingProposedOnly ? " · 제안(미승인)" : " · 현재 저장본"}
                {" · "}
                {summary.metricsLabelKo}
              </p>
            )}
          </div>
          {portfolioReady && summary.legacyIncomplete && (
            <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900">
              종목 상세 확인 필요
            </span>
          )}
        </div>

        {portfolioReady ? (
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
        ) : (
          <p className="px-3 py-10 text-center text-xs text-[#64748B]">
            포트폴리오 승인 후 표시됩니다.
          </p>
        )}

        {portfolioReady && summary.hasProposedDiff && (
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
              // 예전에는 왼쪽에 가로막대 차트(IPSRadar), 오른쪽에 IPSSummary 를 2열로
              // 놓았다. 차트를 걷어내면서 감싸던 그리드도 없앤다 — IPSSummary 자체가
              // 이미 sm:grid-cols-2 로 펼쳐지므로, 2열 그리드 안에 하나만 남기면
              // 요약이 왼쪽 반쪽에 눌린다. 점수는 IPSSummary 의 배지가 계속 보여 준다.
              <IPSSummary ips={view.ips} lang="ko" />
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
            {view.cashFlows.slice(0, 12).map((cf) => (
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

      {/* 세금 메모 — taxNote 가 포트폴리오 산출물이라 포트폴리오 승인에 묶는다.
          종합과세 해당 여부만 따로 남겨 봐야 읽을 거리가 되지 않는다. */}
      {portfolioReady && view.tax && (
        <section className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-2">
          <h2 className="text-sm font-bold">세금 요약</h2>
          <p className="mt-1 text-xs text-[#475569]">
            {view.tax.comprehensive
              ? "금융소득 종합과세 대상 정보가 입력되어 있습니다."
              : "금융소득 종합과세: 해당 없음/미해당으로 기록됨."}
          </p>
          {view.tax.note && (
            <p className="mt-1 text-xs text-[#64748B]">{view.tax.note}</p>
          )}
        </section>
      )}

      {ipsReady && (
        <p className="rounded border border-[#DCE4F5] bg-[#F0F3FA] px-3 py-2 text-[11px] text-[#1428A0]">
          IPS가 확정되어 있습니다. 최종 PDF는 승인 시점 스냅샷이며, 이 화면의 이후 수정과
          자동으로 바뀌지 않습니다.
        </p>
      )}

      {/* 예전에는 여기에 "포트폴리오 미승인 — 표시 내용은 최종 확정이 아닙니다" 배너가
          있었다. 이제 미승인이면 그 내용 자체를 보여 주지 않으므로 가리키는 대상이
          없어졌다. 안내는 가려진 자리("포트폴리오 승인 후 표시됩니다")가 대신한다. */}

      {onGoPb && (
        <div className="text-center">
          <button type="button" className="btn-outline text-sm" onClick={onGoPb}>
            ← PB 화면으로
          </button>
        </div>
      )}

      {/* 공유 링크로 열었을 때만 유효기간을 알린다. PB 탭에는 만료 개념이 없다. */}
      {!live && (
        <p className="text-center text-[10px] text-[#94A3B8]">
          이 링크는 {formatDate(view.expiresAt.slice(0, 10))}까지 유효합니다.
        </p>
      )}
    </div>
  );
}


function Kpi({
  label,
  value,
  note,
  danger,
  muted,
}: {
  label: string;
  value: string;
  note?: string;
  danger?: boolean;
  /** 승인 전 자리표시자 — 실제 수치와 같은 무게로 읽히지 않게 흐리게 그린다. */
  muted?: boolean;
}) {
  return (
    <div className="rounded-lg border border-[#E2E8F0] bg-white px-3 py-2">
      <p className="text-[10px] font-semibold text-[#64748B]">{label}</p>
      <p
        className={`mt-0.5 tabular-nums ${
          muted
            ? "text-xs font-medium text-[#94A3B8]"
            : `text-sm font-bold sm:text-base ${danger ? "text-red-600" : "text-[#0F172A]"}`
        }`}
      >
        {value}
      </p>
      {note && <p className="mt-0.5 text-[9px] text-[#94A3B8]">{note}</p>}
    </div>
  );
}
