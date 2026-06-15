"use client";

// 투자정책서(IPS) 문서 — 인쇄/PDF 저장용. 고객 데이터로 자동 생성.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Client, PB } from "@/lib/types";
import { FACTOR_META } from "@/lib/types";
import { getClient, listPbs } from "@/lib/store";
import { formatKRW, formatDate } from "@/lib/format";
import { LoadingView, ErrorView } from "@/components/StateViews";

// 7요인 값을 엮어 PB 종합 분석 문장 생성
function buildSummary(client: Client): string {
  const ips = client.ips;
  const t = client.clientType === "corporate" ? "법인" : "개인";
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
              ["구분", client.clientType === "corporate" ? "법인" : "개인"],
              ["식별코드", client.code],
              [
                client.clientType === "corporate" ? "설립일" : "생년월일",
                formatDate(client.birthDate),
              ],
              ["자산규모", formatKRW(client.assetSize)],
              ["담당 PB", pbDisplay],
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
            (() => {
              const inflows = client.cashFlows.filter((c) => c.amount >= 0);
              const outflows = client.cashFlows.filter((c) => c.amount < 0);
              const sumIn = inflows.reduce((s, c) => s + c.amount, 0);
              const sumOut = outflows.reduce((s, c) => s + Math.abs(c.amount), 0);
              const net = sumIn - sumOut;
              return (
                <div className="text-xs">
                  {/* 수익 (유입) */}
                  <CfGroup
                    title="Ⅰ. 수익 (현금 유입)"
                    items={inflows.map((c) => ({
                      label: (c.label || "(항목)") + (c.recurring ? " (정기)" : ""),
                      date: c.date || "시점 미정",
                      amount: c.amount,
                    }))}
                    subtotalLabel="수익 소계"
                    subtotal={sumIn}
                    positive
                  />
                  {/* 비용 (유출) */}
                  <CfGroup
                    title="Ⅱ. 비용 (현금 유출)"
                    items={outflows.map((c) => ({
                      label: (c.label || "(항목)") + (c.recurring ? " (정기)" : ""),
                      date: c.date || "시점 미정",
                      amount: Math.abs(c.amount),
                    }))}
                    subtotalLabel="비용 소계"
                    subtotal={sumOut}
                  />
                  {/* 순현금흐름 */}
                  <div className="mt-2 flex items-center justify-between border-t-2 border-gray-800 py-2 font-bold">
                    <span>Ⅲ. 순현금흐름 (수익 − 비용)</span>
                    <span className={net < 0 ? "text-red-600" : "text-gray-900"}>
                      {net < 0 ? "−" : "+"}
                      {formatKRW(Math.abs(net))}
                    </span>
                  </div>
                  <p className="mt-1 text-[10px] text-gray-400">
                    ※ 정기 항목은 월 단위 기준이며, 시점이 명시된 일회성 항목과 함께 표기.
                  </p>
                </div>
              );
            })()
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
              <table className="w-full text-xs">
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

// 현금흐름 그룹(수익/비용) — 항목 + 소계
function CfGroup({
  title,
  items,
  subtotalLabel,
  subtotal,
  positive = false,
}: {
  title: string;
  items: { label: string; date: string; amount: number }[];
  subtotalLabel: string;
  subtotal: number;
  positive?: boolean;
}) {
  return (
    <div className="mb-2">
      <p className="border-b border-gray-300 py-1 font-semibold text-gray-700">{title}</p>
      {items.length === 0 ? (
        <p className="py-1 pl-3 text-gray-400">해당 없음</p>
      ) : (
        items.map((it, i) => (
          <div key={i} className="flex items-center justify-between py-1 pl-3">
            <span className="text-gray-700">
              {it.label}
              <span className="ml-2 text-gray-400">{it.date}</span>
            </span>
            <span className="text-gray-900">
              {positive ? "+" : "−"}
              {formatKRW(it.amount)}
            </span>
          </div>
        ))
      )}
      <div className="flex items-center justify-between border-t border-gray-200 py-1 font-semibold">
        <span className="text-gray-600">{subtotalLabel}</span>
        <span className={positive ? "text-gray-900" : "text-red-600"}>
          {positive ? "+" : "−"}
          {formatKRW(subtotal)}
        </span>
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
