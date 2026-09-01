"use client";

// ★팀원 담당 화면 — 포트폴리오 & 스트레스 테스트 (더미 스캐폴드)
// 인터페이스·UI·더미 동작만. 실제 최적화/검정 로직은 팀원이 lib/portfolio.ts,
// lib/stresstest.ts 본문을 채운다. TODO(팀원) 주석 참고.

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import type { Client, Portfolio } from "@/lib/types";
import { FACTOR_META } from "@/lib/types";
import { updateClient } from "@/lib/store";
import { formatKRW } from "@/lib/format";
import PortfolioPanel from "@/components/PortfolioPanel";
import { LoadingView, ErrorView } from "@/components/StateViews";

export default function PortfolioPage() {
  const { pbId, clientId } = useParams<{ pbId: string; clientId: string }>();
  const router = useRouter();
  const [client, setClient] = useState<Client | null>(null);
  const [status, setStatus] = useState<"loading" | "error" | "ready">("loading");
  // 패널에서 현재 선택·편집 중인 포트폴리오 (최종 확정 시 저장)
  const [chosen, setChosen] = useState<Portfolio | null>(null);
  const [portfolioDetailMode, setPortfolioDetailMode] = useState(false);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const response = await fetch(
        `/api/pb/context?pbId=${encodeURIComponent(pbId)}&clientId=${encodeURIComponent(clientId)}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      if (!response.ok) return setStatus("error");
      const data = await response.json() as { client: Client | null };
      const c = data.client;
      if (!c) return setStatus("error");
      setClient(c);
      setStatus("ready");
    } catch (e) {
      console.error(e);
      setStatus("error");
    }
  }, [clientId, pbId]);

  useEffect(() => {
    load();
  }, [load]);

  // 포트폴리오 최종 확정 — 현재 선택한 포트폴리오를 저장 + 단계 확정
  const finalizePortfolio = async () => {
    if (!client) return;
    if (!chosen) {
      alert("포트폴리오를 선택·편집한 뒤 확정하세요.");
      return;
    }
    if (!confirm(`'${chosen.label}'(으)로 최종 확정할까요?`)) return;
    const stages = { ...(client.stages ?? {}), portfolio: true };
    await updateClient(client.id, { portfolios: [chosen], stages });
    setClient({ ...client, portfolios: [chosen], stages });
  };

  const unconfirmPortfolio = async () => {
    if (!client) return;
    if (!confirm("최종 확정을 해제하고 다시 편집할까요?")) return;
    const stages = { ...(client.stages ?? {}), portfolio: false, stress: false };
    await updateClient(client.id, { stages });
    setClient({ ...client, stages });
  };

  // 스트레스/IPS 단계 완료 표시 (수동 확정)
  const toggleStage = async (key: "ips") => {
    if (!client) return;
    const stages = { ...(client.stages ?? {}), [key]: !client.stages?.[key] };
    await updateClient(client.id, { stages });
    setClient({ ...client, stages });
  };

  if (status === "loading") return <LoadingView />;
  if (status === "error" || !client)
    return <ErrorView message="고객 정보를 불러올 수 없습니다." onRetry={load} />;

  const confirmedFactors = FACTOR_META.filter((m) => {
    const f = client.ips[m.key];
    return f.reviewed && (f.status === "explicit" || f.value);
  });

  return (
    <div className="space-y-6">
      <button
        className="text-xs text-fg-muted hover:text-fg"
        onClick={() => router.push(`/pb/${pbId}/${clientId}`)}
      >
        ← 고객 상세
      </button>

      {/* 디스클레이머 배너 */}
      <div className="rounded-lg border border-gold-400 bg-gold-50 px-4 py-3 text-sm text-gold-800 dark:border-gold-600 dark:bg-gold-900/30 dark:text-gold-200">
        <b>포트폴리오 확정 화면</b> 선택한 제안안을 확정하면 별도 스트레스 탭의 분석 기준으로 사용됩니다.
      </div>

      <div>
        <h1 className="text-xl font-bold text-fg">
          {client.name} · 포트폴리오
        </h1>
        <p className="text-sm text-fg-muted">
          자산규모 {formatKRW(client.assetSize)}
        </p>
      </div>

      {/* 입력 요약 (읽기 전용) */}
      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-fg-muted">
          산출 입력 요약 (확정 7요인 · 현금흐름 · 특이사항)
        </h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <p className="mb-1 text-xs font-medium text-fg">확정 7요인</p>
            {confirmedFactors.length === 0 ? (
              <p className="text-xs text-fg-muted">검토 확정된 요인이 없습니다.</p>
            ) : (
              <ul className="space-y-1 text-xs text-fg-muted">
                {confirmedFactors.map((m) => (
                  <li key={m.key}>
                    <b className="text-fg">{m.label}</b>: {client.ips[m.key].value || "—"}
                    {client.ips[m.key].score != null && (
                      <span className="text-gold-600 dark:text-gold-300">
                        {" "}
                        ({client.ips[m.key].score}점)
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-fg">현금흐름</p>
            {client.cashFlows.length === 0 ? (
              <p className="text-xs text-fg-muted">등록된 현금흐름이 없습니다.</p>
            ) : (
              <ul className="space-y-1 text-xs text-fg-muted">
                {client.cashFlows.map((cf) => (
                  <li key={cf.id}>
                    {cf.label || "(무제목)"} · {formatKRW(cf.amount)} · {cf.date || "시점 미정"}
                    {cf.recurring && " · 정기"}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-fg">특이사항 (Unique)</p>
            <p className="text-xs text-fg-muted">
              {client.ips.unique.value ||
                client.ips.unique.inferenceHint ||
                "특이사항 없음"}
            </p>
          </div>
        </div>
      </section>

      {/* 포트폴리오 후보 */}
<section className="relative left-1/2 w-[calc(100vw-1.5rem)] -translate-x-1/2">
  <h2 className="mb-2 text-sm font-semibold text-fg-muted">포트폴리오 후보 3개</h2>
  <PortfolioPanel client={client} pbId={pbId} clientId={clientId} onSelectionChange={setChosen} onDetailModeChange={setPortfolioDetailMode} />
</section>

      {/* 포트폴리오 최종 확정 단계 */}
      {!portfolioDetailMode && (
      <section
        className={`rounded-xl border-2 p-5 shadow-card ${
          client.stages?.portfolio
            ? "border-gold-400 bg-gold-50 dark:bg-gold-900/20"
            : "border-gold-400/60 bg-gradient-to-r from-surface to-gold-50/40 dark:to-gold-900/10"
        }`}
      >
        {client.stages?.portfolio ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-500 text-navy-900">
                ✓
              </span>
              <div>
                <p className="text-base font-bold text-fg">
                  최종 확정: {client.portfolios[0]?.label ?? "포트폴리오"}
                </p>
                <p className="text-xs text-fg-muted">
                  {client.portfolios[0]
                    ? `예상수익 ${client.portfolios[0].expectedReturn}% · 변동성 ${client.portfolios[0].expectedRisk}% · `
                    : ""}
                  고객 화면·스트레스 테스트에 이 포트폴리오가 반영됩니다.
                </p>
              </div>
            </div>
            <button className="btn-outline text-sm" onClick={unconfirmPortfolio}>
              확정 해제 (재편집)
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">📌</span>
              <div>
                <p className="text-base font-bold text-fg">포트폴리오 최종 확정</p>
                <p className="text-xs text-fg-muted">
                  위에서 후보를 선택·편집했다면, 이 포트폴리오를 <b>최종 결정</b>으로 확정하세요.
                  확정하면 그 구성이 저장되어 <b>고객 화면 출력</b>과 <b>스트레스 테스트</b>에 사용됩니다.
                  {chosen && (
                    <span className="text-gold-600 dark:text-gold-300">
                      {" "}(현재 선택: {chosen.label})
                    </span>
                  )}
                </p>
              </div>
            </div>
            <button className="btn-gold px-5 py-2.5 text-sm" onClick={finalizePortfolio}>
              포트폴리오 최종 확정 →
            </button>
          </div>
        )}
      </section>
      )}

      {/* 스트레스 테스트 — 포트폴리오 최종 확정 후 진행 */}


      {/* IPS 문서 (더미) */}
      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-fg-muted">IPS 문서 (투자정책서)</h2>
          <button
            className={client.stages?.ips ? "btn-outline text-xs" : "btn-gold text-xs"}
            onClick={() => toggleStage("ips")}
          >
            {client.stages?.ips ? "단계 완료됨 ✓ (해제)" : "이 단계 완료로 표시"}
          </button>
        </div>
        <div className="card flex flex-col items-center gap-3 p-6 text-center">
          <span className="text-3xl">📄</span>
          <p className="text-sm text-fg-muted">
            7요인·포트폴리오를 반영한 투자정책서(IPS) 출력 — <b>PDF 출력은 추후 제공(더미)</b>.
            완료로 표시하면 고객 화면 진행 현황에 반영됩니다.
          </p>
        </div>
      </section>
    </div>
  );
}
