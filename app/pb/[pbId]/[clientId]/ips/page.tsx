"use client";

// 투자정책서(IPS) 문서 — 인쇄/PDF 저장용. 고객 데이터로 자동 생성.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Client } from "@/lib/types";
import { FACTOR_META } from "@/lib/types";
import { getClient } from "@/lib/store";
import { formatKRW, formatDate } from "@/lib/format";
import { LoadingView, ErrorView } from "@/components/StateViews";

const STATUS_LABEL: Record<string, string> = {
  explicit: "직접 근거",
  inferred: "추론 단서",
  empty: "미언급",
};

export default function IPSDocumentPage() {
  const { pbId, clientId } = useParams<{ pbId: string; clientId: string }>();
  const router = useRouter();
  const [client, setClient] = useState<Client | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const c = await getClient(clientId);
      if (!c) return setStatus("error");
      setClient(c);
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
              ["담당 PB", client.assignedPbId || pbId || "-"],
            ]}
          />
        </Section>

        {/* 2. 투자성향 분석 (RRTTLLU 7요인) */}
        <Section title="2. 투자성향 분석 (RRTTLLU 7요인)">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-gray-300 text-left text-gray-500">
                <th className="py-1.5 pr-2">요인</th>
                <th className="py-1.5 pr-2">값 / 설명</th>
                <th className="py-1.5 pr-2 text-center">점수</th>
                <th className="py-1.5 pr-2 text-center">근거</th>
              </tr>
            </thead>
            <tbody>
              {FACTOR_META.map((m) => {
                const f = client.ips[m.key];
                const score = f.status === "explicit" ? f.score : null;
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
                    <td className="py-1.5 pr-2 text-center font-bold">
                      {score != null ? `${score}/5` : "—"}
                    </td>
                    <td className="py-1.5 pr-2 text-center text-gray-500">
                      {STATUS_LABEL[f.status]}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>

        {/* 3. 예상 현금흐름 */}
        <Section title="3. 예상 현금흐름">
          {client.cashFlows.length === 0 ? (
            <p className="text-xs text-gray-400">등록된 현금흐름이 없습니다.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-300 text-left text-gray-500">
                  <th className="py-1.5">항목</th>
                  <th className="py-1.5">시점</th>
                  <th className="py-1.5 text-right">금액</th>
                </tr>
              </thead>
              <tbody>
                {client.cashFlows.map((cf) => (
                  <tr key={cf.id} className="border-b border-gray-100">
                    <td className="py-1.5">
                      {cf.label || "(항목)"}
                      {cf.recurring && " (정기)"}
                    </td>
                    <td className="py-1.5">{cf.date || "시점 미정"}</td>
                    <td
                      className={`py-1.5 text-right font-medium ${
                        cf.amount < 0 ? "text-red-600" : "text-gray-900"
                      }`}
                    >
                      {cf.amount < 0 ? "−" : "+"}
                      {formatKRW(Math.abs(cf.amount))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
