"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Client } from "@/lib/types";
import { getClient } from "@/lib/store";
import { formatKRW, formatDate } from "@/lib/format";
import IPSRadar from "@/components/IPSRadar";
import IPSSummary from "@/components/IPSSummary";
import { LoadingView, ErrorView } from "@/components/StateViews";

// 고객용 화면 — 상담 단계별 진행 현황을 간결·시각적으로.
export default function ClientView() {
  const { clientId } = useParams<{ clientId: string }>();
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

  // 단계별 확정 여부 = PB가 확정한 상태(client.stages)
  const st = client.stages ?? {};
  const has7Factor = !!st.factors;
  const hasCashFlow = !!st.cashflow;
  const hasPortfolio = !!st.portfolio;
  const hasStress = !!st.stress;
  const hasIps = !!st.ips;

  const steps = [
    { label: "기본 정보", done: !!st.basic },
    { label: "7요인 분석", done: has7Factor },
    { label: "현금흐름", done: hasCashFlow },
    { label: "포트폴리오", done: hasPortfolio },
    { label: "스트레스 테스트", done: hasStress },
    { label: "IPS 문서", done: hasIps },
  ];

  const goPb = () =>
    router.push(
      client.assignedPbId ? `/pb/${client.assignedPbId}/${client.id}` : `/`,
    );

  return (
    <div className="space-y-6">
      {/* 상단 바: 라벨 + PB 화면 전환 (우측 상단) */}
      <div className="flex items-center justify-between gap-3">
        <span className="badge-gold">고객 화면</span>
        <button className="btn-primary text-sm" onClick={goPb}>
          PB 화면 →
        </button>
      </div>

      {/* 디스클레이머 */}
      <div className="rounded-lg border border-border bg-surface-2 px-4 py-2 text-center text-xs text-fg-muted">
        본 화면은 상담 내용 요약입니다. 투자 권유가 아니며, 참고용입니다.
      </div>

      {/* 기본 정보 */}
      <div className="text-center">
        <p className="text-sm text-fg-muted">{client.code}</p>
        <h1 className="mt-1 text-3xl font-bold text-fg">{client.name} 님</h1>
        <p className="mt-2 text-fg-muted">
          자산규모{" "}
          <b className="text-2xl text-gold-500 dark:text-gold-300">
            {formatKRW(client.assetSize)}
          </b>
        </p>
        <p className="mt-1 text-xs text-fg-muted">
          {client.clientType === "corporate" ? "설립일" : "생년월일"}{" "}
          {formatDate(client.birthDate)}
        </p>
      </div>

      {/* 진행 현황 스텝퍼 */}
      <div className="card p-5">
        <h2 className="mb-4 text-center text-sm font-semibold text-fg-muted">
          상담 진행 현황
        </h2>
        <ol className="flex flex-wrap items-center justify-center gap-x-2 gap-y-3">
          {steps.map((s, i) => (
            <li key={s.label} className="flex items-center gap-2">
              <div className="flex flex-col items-center gap-1">
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${
                    s.done
                      ? "bg-gold-500 text-navy-900"
                      : "border border-border bg-surface-2 text-fg-muted"
                  }`}
                >
                  {s.done ? "✓" : i + 1}
                </span>
                <span
                  className={`text-[11px] ${s.done ? "font-medium text-fg" : "text-fg-muted"}`}
                >
                  {s.label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <span
                  className={`mb-4 h-px w-5 ${s.done ? "bg-gold-400" : "bg-border"}`}
                />
              )}
            </li>
          ))}
        </ol>
      </div>

      {/* 7요인 (확정 시) */}
      {has7Factor ? (
        <>
          <div className="card p-5">
            <h2 className="mb-2 text-center text-sm font-semibold text-fg-muted">
              나의 투자성향 한눈에 보기
            </h2>
            <IPSRadar ips={client.ips} height={300} />
          </div>
          <div>
            <h2 className="mb-3 text-sm font-semibold text-fg-muted">투자성향 요약</h2>
            <IPSSummary ips={client.ips} />
          </div>
        </>
      ) : (
        <div className="card p-6 text-center text-sm text-fg-muted">
          아직 투자성향(7요인) 정리가 완료되지 않았습니다. PB와 상담 후 표시됩니다.
        </div>
      )}

      {/* 현금흐름 (확정 시) */}
      {hasCashFlow && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-fg-muted">예상 현금흐름</h2>
          <div className="card divide-y divide-border">
            {client.cashFlows.map((cf) => (
              <div key={cf.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-fg">
                  {cf.label || "(항목)"}
                  <span className="ml-2 text-xs text-fg-muted">
                    {cf.date || "시점 미정"}
                    {cf.recurring && " · 정기"}
                  </span>
                </span>
                <span
                  className={`font-semibold ${
                    cf.amount < 0 ? "text-red-500" : "text-gold-600 dark:text-gold-300"
                  }`}
                >
                  {cf.amount < 0 ? "−" : "+"}
                  {formatKRW(Math.abs(cf.amount))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 포트폴리오 (확정 시) */}
      {hasPortfolio && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-fg-muted">추천 포트폴리오</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {client.portfolios.map((p) => (
              <div key={p.id} className="card p-4">
                <p className="text-base font-bold text-fg">{p.label}</p>
                <div className="mt-2 flex justify-between text-xs">
                  <span className="text-fg-muted">예상 수익</span>
                  <span className="font-semibold text-gold-600 dark:text-gold-300">
                    {p.expectedReturn}%
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-fg-muted">예상 변동성</span>
                  <span className="font-semibold text-fg">{p.expectedRisk}%</span>
                </div>
                <div className="mt-3 space-y-1">
                  {p.allocations.map((a, i) => (
                    <div key={i} className="text-[11px]">
                      <div className="flex justify-between">
                        <span className="text-fg-muted">{a.assetClass}</span>
                        <span className="text-fg">{a.weight}%</span>
                      </div>
                      <div className="mt-0.5 h-1.5 rounded-full bg-surface-2">
                        <div
                          className="h-1.5 rounded-full bg-gold-400"
                          style={{ width: `${Math.min(100, a.weight)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-center text-[11px] text-fg-muted">
            ※ 참고용이며 투자 권유가 아닙니다. PB 검토를 전제로 한 예시입니다.
          </p>
        </div>
      )}

      {/* 스트레스 테스트 (확정 시 · 더미) */}
      {hasStress && (
        <div>
          <h2 className="mb-3 text-sm font-semibold text-fg-muted">스트레스 테스트 (예시)</h2>
          <div className="card divide-y divide-border">
            {[
              { name: "금리 +2%p", drawdown: "-6%" },
              { name: "주식 -30%", drawdown: "-12%" },
              { name: "인플레 급등", drawdown: "-5%" },
            ].map((s) => (
              <div key={s.name} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="text-fg">{s.name}</span>
                <span className="font-semibold text-red-500">예상 최대낙폭 {s.drawdown}</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-center text-[11px] text-fg-muted">
            ※ 더미(예시) 결과입니다. 실제 검정은 PB·운용팀이 수행합니다.
          </p>
        </div>
      )}

      {/* IPS 문서 (확정 시 · 더미) */}
      {hasIps && (
        <div className="card flex flex-col items-center gap-3 p-6 text-center">
          <span className="text-3xl">📄</span>
          <p className="text-base font-bold text-fg">투자정책서(IPS)가 준비되었습니다</p>
          <p className="max-w-md text-sm text-fg-muted">
            7요인 분석과 포트폴리오 구성을 반영한 투자정책서 예시입니다. (PDF 출력은 추후 제공)
          </p>
          <button
            className="btn-outline text-sm"
            onClick={() => alert("IPS 문서 PDF 출력은 준비 중입니다 (더미).")}
          >
            IPS 문서 보기 (예시)
          </button>
        </div>
      )}

      <div className="text-center">
        <button className="btn-outline text-sm" onClick={goPb}>
          ← PB 화면으로
        </button>
      </div>
    </div>
  );
}
