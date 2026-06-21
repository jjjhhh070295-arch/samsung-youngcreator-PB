"use client";

// 투자정책서(IPS) 문서 — 인쇄/PDF 저장용. 고객 데이터로 자동 생성.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
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
import { LoadingView, ErrorView } from "@/components/StateViews";

const CHART_COLORS = ["#0f172a", "#d6a84f", "#2563eb", "#10b981", "#ef4444", "#8b5cf6", "#64748b"];

const BACKTEST_SERIES = {
  equity: [0, -1.4, 0.6, 2.8, 4.4, 3.1, 6.2, 5.7, 8.9, 7.5, 10.4, 9.2, 11.1],
  bond: [0, 0.4, -0.2, 0.5, 1.1, 0.9, 1.6, 1.8, 2.1, 2.0, 2.6, 2.4, 2.9],
  cash: [0, 0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0],
  alt: [0, 0.8, 0.1, 1.4, 2.6, 1.8, 3.5, 2.9, 4.8, 4.2, 5.6, 5.0, 6.1],
};

function allocationBucket(assetClass: string): keyof typeof BACKTEST_SERIES {
  if (/주식|ETF|Equity/i.test(assetClass)) return "equity";
  if (/채권|ELS|ELB|Bond/i.test(assetClass)) return "bond";
  if (/현금|MMF|RP|CMA|Cash/i.test(assetClass)) return "cash";
  return "alt";
}

function buildBacktestData(pf: Client["portfolios"][number] | undefined) {
  const labels = ["12M 전", "11M", "10M", "9M", "8M", "7M", "6M", "5M", "4M", "3M", "2M", "1M", "현재"];
  if (!pf) return [];
  const total = pf.allocations.reduce((sum, item) => sum + item.weight, 0) || 100;
  return labels.map((label, index) => {
    const portfolio = pf.allocations.reduce((sum, item) => {
      const bucket = allocationBucket(item.assetClass);
      return sum + (item.weight / total) * BACKTEST_SERIES[bucket][index];
    }, 0);
    const blendedBenchmark = BACKTEST_SERIES.equity[index] * 0.55 + BACKTEST_SERIES.bond[index] * 0.35 + BACKTEST_SERIES.cash[index] * 0.1;
    return {
      label,
      portfolio: Math.round(portfolio * 10) / 10,
      blendedBenchmark: Math.round(blendedBenchmark * 10) / 10,
    };
  });
}

function buildCashflowSummary(cashFlows: Client["cashFlows"]) {
  const recurringIn = cashFlows.filter((flow) => flow.recurring && flow.amount > 0).reduce((sum, flow) => sum + flow.amount, 0);
  const recurringOut = cashFlows.filter((flow) => flow.recurring && flow.amount < 0).reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
  const oneOffIn = cashFlows.filter((flow) => !flow.recurring && flow.amount > 0).reduce((sum, flow) => sum + flow.amount, 0);
  const oneOffOut = cashFlows.filter((flow) => !flow.recurring && flow.amount < 0).reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
  const taxOut = cashFlows
    .filter((flow) => flow.amount < 0 && /세|tax|증여|상속|양도|부가세|종부|법인세/i.test(`${flow.label} ${flow.category ?? ""}`))
    .reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
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
    taxOut,
    net: recurringIn + oneOffIn - recurringOut - oneOffOut,
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

export default function IPSDocumentPage() {
  const { pbId, clientId } = useParams<{ pbId: string; clientId: string }>();
  const router = useRouter();
  const [client, setClient] = useState<Client | null>(null);
  const [pbs, setPbs] = useState<PB[]>([]);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");

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

  if (status === "loading") return <LoadingView />;
  if (status === "error" || !client)
    return <ErrorView message="고객 정보를 불러올 수 없습니다." onRetry={load} />;

  const today = new Date();
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`;
  const pf = client.portfolios[0];
  const cashflowSummary = buildCashflowSummary(client.cashFlows);
  const allocationChartData = pf?.allocations.map((allocation) => ({
    name: allocation.assetClass,
    value: allocation.weight,
  })) ?? [];
  const backtestData = buildBacktestData(pf);

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
        <button className="btn-gold text-sm" onClick={() => window.print()}>
          🖨️ 인쇄 / PDF로 저장
        </button>
      </div>

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

        {/* 3. 예상 현금흐름 (재무제표 형식: 수익/비용) */}
        <Section title="3. 예상 현금흐름">
          {client.cashFlows.length === 0 ? (
            <p className="text-xs text-gray-400">등록된 현금흐름이 없습니다.</p>
          ) : (
            <div className="space-y-3 text-xs">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-gray-300 text-left text-gray-500">
                    <th className="py-1.5">구분</th>
                    <th className="py-1.5 text-right">금액</th>
                    <th className="py-1.5">해석</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["정기 유입", cashflowSummary.recurringIn, "월 반복 소득/매출"],
                    ["정기 유출", -cashflowSummary.recurringOut, "월 반복 생활비/운영비"],
                    ["일회 유입", cashflowSummary.oneOffIn, "매각·배당·상여 등"],
                    ["일회 유출", -cashflowSummary.oneOffOut, "세금·CAPEX·증여 등"],
                    ["세금성 예정 유출", -cashflowSummary.taxOut, "상담용 추정, 전문가 확인 필요"],
                    ["순현금흐름", cashflowSummary.net, "포트폴리오 유동성 버킷 산출 기준"],
                  ].map(([label, amount, note]) => (
                    <tr key={String(label)} className="border-b border-gray-100">
                      <td className="py-1.5 font-semibold">{label}</td>
                      <td className={`py-1.5 text-right font-medium ${Number(amount) < 0 ? "text-red-600" : "text-gray-900"}`}>
                        {Number(amount) < 0 ? "−" : "+"}
                        {formatKRW(Math.abs(Number(amount)))}
                      </td>
                      <td className="py-1.5 pl-3 text-gray-500">{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="rounded border border-gray-200 bg-gray-50 p-3">
                <p className="mb-2 font-semibold text-gray-800">주요 현금흐름 일정</p>
                <table className="w-full text-xs">
                  <tbody>
                    {cashflowSummary.upcoming.map((flow) => (
                      <tr key={flow.id} className="border-b border-gray-200 last:border-0">
                        <td className="py-1 text-gray-500">{flow.date || "시점 미정"}</td>
                        <td className="py-1">{flow.label || "(항목)"}</td>
                        <td className="py-1 text-gray-500">{flow.entity ?? flow.category ?? ""}</td>
                        <td className={`py-1 text-right font-medium ${flow.amount < 0 ? "text-red-600" : "text-gray-900"}`}>
                          {flow.amount < 0 ? "−" : "+"}
                          {formatKRW(Math.abs(flow.amount))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded border border-gray-200 p-3">
                  <p className="mb-2 text-xs font-semibold text-gray-700">자산배분 도넛차트</p>
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
                  <p className="mb-2 text-xs font-semibold text-gray-700">최근 1년 백테스트 추정</p>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={backtestData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                        <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" />
                        <XAxis dataKey="label" tick={{ fontSize: 9, fill: "#6b7280" }} />
                        <YAxis unit="%" tick={{ fontSize: 9, fill: "#6b7280" }} />
                        <Tooltip formatter={(value: unknown) => `${Number(value).toFixed(1)}%`} />
                        <Line type="monotone" dataKey="portfolio" name="제안 포트폴리오" stroke="#0f172a" strokeWidth={2.5} dot={false} />
                        <Line type="monotone" dataKey="blendedBenchmark" name="혼합 벤치마크" stroke="#10b981" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mt-1 text-[10px] leading-relaxed text-gray-400">
                    대표 지수 기반 12개월 누적수익률 추정치입니다. 과거 성과는 미래 수익을 보장하지 않습니다.
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
                  {pf.allocations.map((a, i) => (
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

        {/* 디스클레이머 */}
        <div className="mt-6 rounded border border-gray-300 bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-600">
          ※ 본 투자정책서는 PB 상담 내용을 구조화한 <b>참고용 문서</b>이며 투자 권유가 아닙니다.
          포트폴리오·스트레스 결과는 통계적 추정치로 미래 수익을 보장하지 않으며, 실제 투자 결정 및
          집행은 고객 본인의 판단과 책임 하에 이루어집니다.
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
