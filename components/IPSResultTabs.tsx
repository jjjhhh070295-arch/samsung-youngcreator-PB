"use client";

import { useEffect, useMemo, useRef, useState, type HTMLAttributes } from "react";
import { useRouter } from "next/navigation";
import type { Client, FinancialIncomeProfile, Portfolio, StageKey } from "@/lib/types";
import { ACCOUNT_SEPARATION_LABEL, CLIENT_TYPE_LABEL, FACTOR_META, computeStages } from "@/lib/types";
import { formatKRW } from "@/lib/format";
import { loadSimpleCashflowRows, summarizeSimpleCashflowRows } from "@/lib/simpleCashflow";
import PortfolioPanel from "./PortfolioPanel";
import type { PlanSummaryItem, PlanRowOrigin } from "./StockSectorPanel";
import StressTestPanel from "./StressTestPanel";
import TaxProjectionPanel from "./TaxProjectionPanel";
import ManualPortfolioBuilder from "./ManualPortfolioBuilder";
import ConsultationEndButton from "./ConsultationEndButton";
import PortfolioWorkflowStepper from "./PortfolioWorkflowStepper";
import ScoreRubricButton from "./ScoreRubricButton";
import { buildPortfolioViewModel, type HeldAssets } from "@/lib/portfolio";
import { FALLBACK_MARKET_RESEARCH, type MarketResearchItem } from "@/lib/portfolioResearch";
import { loadBundle } from "@/lib/advisory/control";
import {
  isBasicWorkflowApproved,
  isIpsWorkflowApproved,
  isPortfolioWorkflowApproved,
  workflowPdfBlockReason,
  workflowPdfReady,
} from "@/lib/advisory/workflowApprovals";
import { ipsExtractionMissingReasons } from "@/lib/advisory/ipsExtraction";
import type { PortfolioWorkflowStep } from "@/lib/portfolioWorkflowStep";

interface Props {
  client: Client;
  allClients: Client[];
  pbId: string;
  clientId: string;
  tab: Tab;
  onSetTab: (t: Tab) => void;
  onEdit: () => void;
  onSavePortfolios: (portfolios: Portfolio[]) => Promise<void> | void;
  onFinalizePortfolio: (portfolio: Portfolio) => Promise<void> | void;
  onUnfinalizePortfolio: () => Promise<void> | void;
  onToggleStage: (key: StageKey) => Promise<void> | void;
  onApprovePortfolioWorkflow: () => Promise<void> | void;
  onApproveIpsWorkflow: () => Promise<void> | void;
  onPortfolioDraftChanged?: () => void;
  linkedClient?: Client | null;
  onChangeComprehensiveTax?: (value: boolean) => Promise<void> | void;
  onChangeFinancialIncomeProfile?: (profile: FinancialIncomeProfile) => Promise<void> | void;
  portfolioStep?: PortfolioWorkflowStep;
  onNavigatePortfolioStep?: (step: PortfolioWorkflowStep) => void;
};

export type Tab =
  | "basic"
  | "cashflow"
  | "portfolio"
  | "portfolio2"
  | "taxProjection"
  | "stress"
  | "ips"
  | "customer";

// 상담 전 과정을 하나의 탭 바로 — 현금흐름/포트폴리오/세전세후/스트레스/IPS
// (7요인은 기본 정보 화면으로 이동 — components/FactorsSummary.tsx)
export default function IPSResultTabs({
  client,
  allClients,
  pbId,
  clientId,
  tab,
  onSetTab,
  onEdit,
  onSavePortfolios,
  onFinalizePortfolio,
  onUnfinalizePortfolio,
  onToggleStage,
  onApprovePortfolioWorkflow,
  onApproveIpsWorkflow,
  onPortfolioDraftChanged,
  linkedClient,
  onChangeComprehensiveTax,
  onChangeFinancialIncomeProfile,
  portfolioStep = "allocation",
  onNavigatePortfolioStep,
}: Props) {
  const router = useRouter();
  const ips = client.ips;
  const done = computeStages(client);

  // 포트폴리오 패널에서 현재 선택·편집 중인 포트폴리오 (최종 확정 저장용)
  const [chosen, setChosen] = useState<Portfolio | null>(null);
  // PB 검토용 종목 입력 최신값 — 확정 시점에만 localStorage 저장에 사용
  const planSummaryRef = useRef<PlanSummaryItem[]>([]); // 섹터 ETF 변환 결과
  const planRowsRef = useRef<PlanRowOrigin[]>([]);      // PB 입력 원본 종목

  // 마운트 시 localStorage에서 확정 저장값을 읽어 원본 종목 복원 (v2 우선, v1은 원본 없음→생략)
  const [restoredRows, setRestoredRows] = useState<PlanRowOrigin[]>([]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(`pb-plan-${clientId}`);
      if (!raw) { setRestoredRows([]); return; }
      const parsed = JSON.parse(raw);
      // v2: { version:2, rows:[{stockCode,stockName,amountKrw}], summary:[...] } → rows로 원본 복원
      if (parsed && parsed.version === 2 && Array.isArray(parsed.rows)) {
        const rows: PlanRowOrigin[] = parsed.rows
          .filter((r: any) => r && typeof r.stockCode === "string" && Number(r.amountKrw) > 0)
          .map((r: any) => ({ stockCode: r.stockCode, stockName: r.stockName ?? r.stockCode, amountKrw: Number(r.amountKrw) }));
        setRestoredRows(rows);
        return;
      }
      // v1(배열만): summary만 있어 원본 종목코드가 없으므로 종목 단위 복원은 생략
      setRestoredRows([]);
    } catch {
      setRestoredRows([]); // 깨진 값/파싱 실패 → 빈 상태
    }
  }, [clientId]);
  const [portfolioDetailMode, setPortfolioDetailMode] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const simpleCashflowTotals = useMemo(
    () => summarizeSimpleCashflowRows(loadSimpleCashflowRows(client.cashFlows)),
    [client.cashFlows],
  );

  // PortfolioPanel에서 계산된 보유자산을 받아 스트레스 weights에도 동일하게 반영
  const [heldAssets, setHeldAssets] = useState<HeldAssets | undefined>(undefined);
  const [researchItems, setResearchItems] = useState<MarketResearchItem[]>(FALLBACK_MARKET_RESEARCH);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/research", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && Array.isArray(data?.items) && data.items.length > 0) {
          setResearchItems(data.items);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // 확정 시점의 분석 리포트 중 "영향 큰 상위 N개"를 가져와 포트폴리오에 박제
  async function pickTopReports(n = 5): Promise<Portfolio["referencedReports"]> {
    try {
      const res = await fetch("/api/research/signals", { cache: "no-store" });
      const data = await res.json();
      const reports: any[] = data?.reports ?? [];
      return reports
        .map((r) => ({
          report: r,
          power: (r.signals ?? []).reduce((s: number, x: any) => s + (x.strength || 0), 0),
        }))
        .filter((x) => x.power > 0)
        .sort((a, b) => b.power - a.power)
        .slice(0, n)
        .map((x) => ({
          title: x.report.title,
          source: x.report.source,
          url: x.report.url,
          date: x.report.date ?? null,
          summary: x.report.summary ?? "",
          signals: x.report.signals ?? [],
        }));
    } catch {
      return [];
    }
  }

  const finalizePortfolio = async () => {
    if (!chosen) {
      alert("포트폴리오를 선택·편집한 뒤 확정하세요.");
      return;
    }
    if (!confirm(`'${chosen.label}'(으)로 최종 확정할까요?`)) return;

    // 확정 시점의 PB 검토용 종목 입력을 고객 단위로 분리 저장 (v2: 원본 종목 rows + 변환 summary).
    // rows가 비면 no-op(기존 값 보존), localStorage 실패해도 확정은 그대로 진행.
    const rows = planRowsRef.current;
    const summary = planSummaryRef.current;
    if (typeof window !== "undefined" && rows.length > 0) {
      try {
        window.localStorage.setItem(
          `pb-plan-${clientId}`,
          JSON.stringify({ version: 2, rows, summary }),
        );
      } catch {
        /* localStorage 접근 실패 무시 — 확정 흐름은 계속 */
      }
    }

    setFinalizing(true);
    try {
      const referencedReports = await pickTopReports(5);
      // 확정 시점 박제: 구조(allocations)·근거(referencedReports)·확정시각을 함께 저장 → 이후 리서치가 바뀌어도 고정
      await onFinalizePortfolio({ ...chosen, referencedReports, confirmedAt: new Date().toISOString() });
    } finally {
      setFinalizing(false);
    }
  };

  const unconfirmPortfolio = async () => {
    if (!confirm("최종 확정을 해제하고 다시 편집할까요?")) return;
    await onUnfinalizePortfolio();
  };

  // 포트폴리오 탭 상단 "산출 입력 요약"용 — 검토 확정된 7요인만
  const confirmedFactors = useMemo(
    () => FACTOR_META.filter((m) => {
      const f = ips[m.key];
      return f.reviewed && (f.status === "explicit" || f.value);
    }),
    [ips],
  );

  // SET 6자산 비중: 확정된 안의 weights만 추출해 세후/StressTestPanel에 전달.
  // PortfolioPanel과 동일하게 heldAssets(보유자산)+researchItems를 사용해
  // 화면 표시와 스트레스 입력 weights를 일치시킨다.
  const stressPortfolioModel = useMemo(
    () => buildPortfolioViewModel(client, researchItems, heldAssets),
    [client, researchItems, heldAssets],
  );
  const portfolioWeights = useMemo(() => {
    const vm = stressPortfolioModel;
    const confirmedId = client.portfolios[0]?.id;
    const confirmed = confirmedId
      ? vm.portfolioOptions.find((o) => o.id === confirmedId)
      : undefined;
    return [(confirmed ?? vm.portfolioOptions[1]).weights];
  }, [client.portfolios, stressPortfolioModel]);
  const stressInvestableKrw = stressPortfolioModel.assetLayer?.investableKrw ?? client.assetSize;
  const stressAssetBaseEstimated = stressPortfolioModel.assetLayer == null;
  const advisoryBundle = loadBundle(clientId);
  const pdfReady = workflowPdfReady(client, advisoryBundle);
  const consultationComplete = Boolean(
    isPortfolioWorkflowApproved(client) && isIpsWorkflowApproved(client) && pdfReady,
  );
  const ipsMissing = ipsExtractionMissingReasons(client);
  const draftAllowed = isPortfolioWorkflowApproved(client);
  const ipsReady = isBasicWorkflowApproved(client) && ipsMissing.length === 0;

  // 단계 완료 토글 버튼 (모든 단계 공통)
  const StageToggle = ({ k }: { k: StageKey }) => (
    <button
      className={client.stages?.[k] ? "btn-outline whitespace-nowrap text-xs" : "btn-gold whitespace-nowrap text-xs"}
      onClick={() => onToggleStage(k)}
    >
      {client.stages?.[k] ? "단계 완료됨 ✓ (해제)" : "이 단계 완료로 표시"}
    </button>
  );

  return (
    <div className="space-y-5">
      {/* 기본정보 */}
      {tab === "basic" && (
        <div>
          <div className="mb-3 flex items-center justify-end">
            <StageToggle k="basic" />
          </div>
          <div className="card grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
            <div>
              <p className="text-xs text-fg-muted">식별코드</p>
              <p className="font-mono text-sm font-semibold text-gold-600 dark:text-gold-300">
                {client.code}
              </p>
            </div>
            <div>
              <p className="text-xs text-fg-muted">구분</p>
              <p className="text-sm font-semibold text-fg">
                {CLIENT_TYPE_LABEL[client.clientType]}
              </p>
            </div>
            <div>
              <p className="text-xs text-fg-muted">이름</p>
              <p className="text-sm font-semibold text-fg">{client.name}</p>
            </div>
            <div>
              {/* AUM — 같은 고객 상세 화면의 프로필 카드·헤더와 같은 값이어야 한다.
                  stressInvestableKrw 는 이 탭이 세금·스트레스 원금으로 이미 쓰는 값이라
                  새 조회를 만들지 않는다. assetLayer 가 없으면 client.assetSize 로 폴백하는데,
                  새 모델에서는 그 값이 곧 AUM 이라 폴백 여부와 무관하게 같은 숫자가 나온다. */}
              <p className="text-xs text-fg-muted">AUM</p>
              <p className="text-sm font-semibold text-fg">
                {(stressInvestableKrw / 1_0000_0000).toLocaleString("ko-KR")}억
              </p>
            </div>
            <div>
              <p className="text-xs text-fg-muted">연동 고객</p>
              {linkedClient ? (
                <button
                  className="text-left text-sm font-semibold text-gold-600 hover:underline dark:text-gold-300"
                  onClick={() => router.push(`/pb/${pbId}/${linkedClient.id}`)}
                >
                  {linkedClient.name}
                </button>
              ) : (
                <p className="text-sm font-semibold text-fg-muted">없음</p>
              )}
            </div>
            <div>
              <p className="text-xs text-fg-muted">지분/통장 상태</p>
              <p className="text-sm font-semibold text-fg">
                {client.accountSeparation
                  ? ACCOUNT_SEPARATION_LABEL[client.accountSeparation]
                  : client.ownershipPct != null
                    ? `${client.ownershipPct}%${client.isMajorityShareholder ? " · 최대주주" : ""}`
                    : "미입력"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 현금흐름 탭은 기본 정보 화면으로 통합됨 — portfolio 탭 요약에서만 참조 */}
      {tab === "portfolio" && (
        <div>
          {/* 산출 입력 요약 (읽기 전용) — 포트폴리오를 짤 때 근거를 옆에 두고 보는 용도 */}
          <section className="card mb-4 p-4">
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
                        <b className="text-fg">{m.label}</b>: {ips[m.key].value || "—"}
                        {ips[m.key].score != null && (
                          <span className="text-gold-600 dark:text-gold-300">
                            {" "}
                            ({ips[m.key].score}점)
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
                    <li>총유입 합계 {formatKRW(simpleCashflowTotals.netInflow)}</li>
                    <li>총유출 합계 {formatKRW(simpleCashflowTotals.netOutflowExTax)}</li>
                    <li>총세금 {formatKRW(simpleCashflowTotals.totalTax)}</li>
                    <li>
                      <b className="text-fg">순자금 {formatKRW(simpleCashflowTotals.netCash)}</b>
                    </li>
                  </ul>
                )}
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-fg">특이사항 (Unique)</p>
                <p className="text-xs text-fg-muted">
                  {ips.unique.value ||
                    ips.unique.inferenceHint ||
                    "특이사항 없음"}
                </p>
              </div>
            </div>
          </section>

          <PortfolioPanel
            client={client}
            pbId={pbId}
            clientId={clientId}
            onSelectionChange={setChosen}
            onHeldAssetsChange={setHeldAssets}
            onDetailModeChange={setPortfolioDetailMode}
            onPlanSummaryChange={(plan) => { planSummaryRef.current = plan; }}
            onPlanRowsChange={(rows) => { planRowsRef.current = rows; }}
            initialPlanRows={restoredRows}
          />

          {/* 최종 확정 단계 */}
          {!portfolioDetailMode && (
          <div
            className={`mt-4 rounded-xl border-2 p-5 shadow-card ${
              done.portfolio
                ? "border-gold-400 bg-gold-50 dark:bg-gold-900/20"
                : "border-gold-400/60 bg-gradient-to-r from-surface to-gold-50/40 dark:to-gold-900/10"
            }`}
          >
            {done.portfolio ? (
              <div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gold-500 text-white">
                      ✓
                    </span>
                    <div>
                      <p className="text-base font-bold text-fg">
                        최종 확정: {client.portfolios[0]?.label ?? "포트폴리오"}
                      </p>
                      <p className="text-xs text-fg-muted">
                        {client.portfolios[0]
                          ? `예상수익 ${
                              client.portfolios[0].expectedReturn == null ||
                              !Number.isFinite(client.portfolios[0].expectedReturn)
                                ? "산출 전"
                                : `${(Math.round(client.portfolios[0].expectedReturn * 10) / 10).toFixed(1)}%`
                            } · 변동성 ${
                              client.portfolios[0].expectedRisk == null ||
                              !Number.isFinite(client.portfolios[0].expectedRisk)
                                ? "산출 전"
                                : `${(Math.round(client.portfolios[0].expectedRisk * 10) / 10).toFixed(1)}%`
                            } · `
                          : ""}
                        고객 화면·스트레스 테스트에 이 포트폴리오가 사용됩니다.
                      </p>
                    </div>
                  </div>
                  <button className="btn-outline text-sm" onClick={unconfirmPortfolio}>
                    확정 해제 (재편집)
                  </button>
                </div>

                {/* 참고 리포트 (확정 시점 박제) */}
                <ReferencedReports
                  reports={client.portfolios[0]?.referencedReports}
                  confirmedAt={client.portfolios[0]?.confirmedAt}
                />
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📌</span>
                  <div>
                    <p className="text-base font-bold text-fg">포트폴리오 최종 확정</p>
                    <p className="text-xs text-fg-muted">
                      위에서 후보를 선택·편집했다면 <b>최종 결정</b>으로 확정하세요. 확정하면 그 구성이
                      저장되어 <b>고객 화면 출력</b>과 <b>스트레스 테스트</b>에 사용됩니다.
                      {chosen && (
                        <span className="text-gold-600 dark:text-gold-300">
                          {" "}(현재 선택: {chosen.label})
                        </span>
                      )}
                    </p>
                  </div>
                </div>
                <button
                  className="btn-gold px-5 py-2.5 text-sm"
                  onClick={finalizePortfolio}
                  disabled={finalizing}
                >
                  {finalizing ? "확정 중…" : "포트폴리오 최종 확정 →"}
                </button>
              </div>
            )}
          </div>
          )}
        </div>
      )}

      {tab === "portfolio2" && (
        <div className="space-y-4">
          <PortfolioWorkflowStepper step={portfolioStep} />

          <ManualPortfolioBuilder
            pbId={pbId}
            clientId={clientId}
            totalAssetWon={client.assetSize}
            onDraftChanged={onPortfolioDraftChanged}
            step={portfolioStep}
            onNavigateStep={onNavigatePortfolioStep}
          />

          <div
            className={portfolioStep === "approval" ? "space-y-4 portfolio-step-pane" : "hidden"}
            aria-hidden={portfolioStep !== "approval"}
            {...(portfolioStep !== "approval" ? ({ inert: true } as unknown as HTMLAttributes<HTMLDivElement>) : {})}
          >
            <div className="rounded-2xl border border-[#1428A0]/20 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#1428A0]">Portfolio approval</p>
                  <h3 className="mt-1 text-base font-bold text-fg">포트폴리오 승인</h3>
                  <p className="mt-1 text-[11px] text-fg-muted">
                    맞춤 배분·종목·세전·세후 결과를 확인한 뒤 승인하면 상담 진행 4~6단계가 완료됩니다.
                  </p>
                </div>
                <button
                  type="button"
                  className={isPortfolioWorkflowApproved(client) ? "btn-outline px-5 py-2.5 text-sm" : "btn-primary px-5 py-2.5 text-sm"}
                  onClick={() => void onApprovePortfolioWorkflow()}
                >
                  {isPortfolioWorkflowApproved(client) ? "포트폴리오 승인 취소" : "포트폴리오 승인"}
                </button>
              </div>
            </div>

            <section id="tax-projection" className="space-y-3 border-t border-border pt-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-[#1428A0]">Tax result</p>
                <h3 className="mt-1 text-base font-black text-fg">세전·세후 결과</h3>
                <p className="mt-1 text-[11px] text-fg-muted">
                  세전 결과 · 세금 · 비용 · 세후 결과를 확인합니다.
                </p>
              </div>
              <TaxProjectionPanel
                client={client}
                baseWeights={portfolioWeights[0]}
                principalWon={stressInvestableKrw}
                assetBaseEstimated={stressAssetBaseEstimated}
                onChangeComprehensiveTax={onChangeComprehensiveTax}
                onChangeFinancialIncomeProfile={onChangeFinancialIncomeProfile}
              />
            </section>

            <div className="sticky bottom-0 z-10 border-t border-border bg-white/95 px-1 py-3 backdrop-blur">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <button
                  type="button"
                  className="btn-outline px-5 py-2.5 text-sm"
                  onClick={() => onNavigatePortfolioStep?.("instruments")}
                >
                  이전: 종목선택
                </button>
                <button
                  type="button"
                  className="btn-primary px-6 py-2.5 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={!isPortfolioWorkflowApproved(client)}
                  onClick={() => onSetTab("ips")}
                >
                  IPS로 이동
                </button>
              </div>
              {!isPortfolioWorkflowApproved(client) && (
                <p className="mt-2 text-[11px] text-fg-muted">
                  포트폴리오 승인 완료 후 IPS로 이동할 수 있습니다.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 세전·세후 — 포트폴리오로 통합됨. 딥링크는 리다이렉트 */}
      {tab === "taxProjection" && (
        <div className="card p-6 text-center">
          <p className="text-sm font-bold text-fg">세전·세후는 포트폴리오 하단에 통합되었습니다.</p>
          <button type="button" className="btn-primary mt-3 text-sm" onClick={() => onSetTab("portfolio2")}>
            포트폴리오로 이동
          </button>
        </div>
      )}

      {/* 스트레스 — 포트폴리오 최종 확정 후 진행 */}
      {tab === "stress" && (
        <div>
          {done.portfolio ? (
            <>
              <div className="mb-3 flex items-center justify-end">
                <StageToggle k="stress" />
              </div>
              <StressTestPanel
                portfolios={client.portfolios}
                portfolioWeights={portfolioWeights}
                investableKrw={stressInvestableKrw}
                assetBaseEstimated={stressAssetBaseEstimated}
              />
            </>
          ) : (
            <div className="card flex flex-col items-center gap-2 p-8 text-center">
              <span className="text-2xl">🔒</span>
              <p className="text-sm font-medium text-fg">포트폴리오를 먼저 최종 확정하세요</p>
              <p className="text-xs text-fg-muted">
                포트폴리오 탭에서 최종 확정해야 그 구성으로 스트레스 테스트를 진행할 수 있습니다.
              </p>
              <button className="btn-outline mt-1 text-xs" onClick={() => onSetTab("portfolio")}>
                포트폴리오 탭으로
              </button>
            </div>
          )}
        </div>
      )}

      {/* IPS — 투자정책서 문서 생성 + 단계 확정 */}
      {tab === "ips" && (
        <div className="space-y-4">
          <div className="mb-1 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              className={isIpsWorkflowApproved(client) ? "btn-outline whitespace-nowrap text-xs" : "btn-primary whitespace-nowrap text-xs"}
              onClick={() => void onApproveIpsWorkflow()}
            >
              {isIpsWorkflowApproved(client) ? "IPS 승인 취소" : "IPS 승인"}
            </button>
            <StageToggle k="ips" />
          </div>

          {!draftAllowed ? (
            <div className="card flex flex-col items-center gap-2 p-8 text-center">
              <span className="text-2xl">🔒</span>
              <p className="text-sm font-medium text-fg">
                IPS 작성을 위해 기본정보 승인과 포트폴리오 승인이 필요합니다.
              </p>
            </div>
          ) : !ipsReady ? (
            <div className="card flex flex-col items-center gap-2 p-8 text-center">
              <span className="text-2xl">⚠️</span>
              <p className="text-sm font-medium text-fg">
                IPS 작성에 필요한 고객 정보가 부족합니다
              </p>
              <ul className="mt-1 max-w-md list-disc space-y-1 pl-5 text-left text-xs text-fg-muted">
                {ipsMissing.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="card space-y-4 p-5">
              <div>
                <p className="decision-kicker">IPS draft</p>
                <h3 className="mt-1 text-lg font-bold text-fg">IPS 초안 미리보기</h3>
                <p className="mt-1 text-xs text-fg-muted">
                  최종 PDF 발행 전 검토용 화면입니다.
                </p>
              </div>
              {/* 예전에는 여기 위에 7요인 가로막대 차트가 있었다. 이 화면에서는 아래
                  카드가 값·메모만 보여 주고 점수를 내보내지 않아, 차트를 걷어내면 점수를
                  볼 방법이 아예 사라진다 — 다른 세 화면과 달리 대체할 표시가 없었다.
                  그래서 카드에 점수 배지를 더한다. 근거가 명시된(explicit) 요인만
                  표시하는 것은 IPSSummary 와 같은 규칙이다 — 추론값에 점수를 붙이면
                  확정된 것처럼 읽힌다. */}
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {FACTOR_META.map((m) => {
                  const f = client.ips[m.key];
                  const hasScore = f?.status === "explicit" && f?.score != null;
                  return (
                    <div key={m.key} className="rounded-lg border border-border bg-surface-2/40 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-fg-muted">
                          {m.label} ({m.labelEn})
                        </p>
                        {hasScore && (
                          <span className="badge-gold shrink-0 text-[10px]">{f.score}/5</span>
                        )}
                      </div>
                      <p className="mt-1 text-sm font-semibold text-fg">{f?.value?.trim() || "—"}</p>
                      {f?.notes?.trim() && (
                        <p className="mt-1 text-[11px] text-fg-muted">{f.notes}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="card flex flex-col items-center gap-4 p-8 text-center">
            <span className="text-3xl">{consultationComplete ? "✓" : "📄"}</span>
            <div>
              <p className="decision-kicker">Final decision</p>
              <p className="mt-1 text-xl font-bold text-fg">{consultationComplete ? "상담 완료" : "투자정책서 (IPS) 문서"}</p>
              <p className="mt-1 max-w-md text-sm text-fg-muted">
                {consultationComplete
                  ? `${client.name} 고객의 최종 투자전략이 확정되었습니다.`
                  : "고객 기본정보 · RRTTLLU 7요인 · 현금흐름 · 확정 포트폴리오를 모아 정식 투자정책서로 생성합니다."}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2 text-xs">
              <span className={done.factors ? "badge-success" : "badge-muted"}>고객 분석 {done.factors ? "완료" : "대기"}</span>
              <span className={isIpsWorkflowApproved(client) ? "badge-success" : "badge-muted"}>
                IPS 승인 {isIpsWorkflowApproved(client) ? "완료" : "대기"}
              </span>
              <span className={done.portfolio ? "badge-success" : "badge-muted"}>포트폴리오 {done.portfolio ? "확정" : "대기"}</span>
              <span className={done.stress ? "badge-success" : "badge-muted"}>스트레스 테스트 {done.stress ? "완료" : "대기"}</span>
            </div>
            {!pdfReady && (
              <p className="text-xs font-semibold text-[#1428A0]">
                {workflowPdfBlockReason(client, advisoryBundle) || "IPS 승인 후 최종 PDF를 발행할 수 있습니다."}
              </p>
            )}
            <div className="flex flex-wrap justify-center gap-2">
              <button
                className="btn-outline px-6 py-2.5"
                disabled={!draftAllowed}
                onClick={() => router.push(`/pb/${pbId}/${clientId}/ips?mode=draft`)}
              >
                IPS 초안 미리보기
              </button>
              <button
                className="btn-primary px-6 py-2.5"
                disabled={!pdfReady}
                onClick={() => router.push(`/pb/${pbId}/${clientId}/ips`)}
              >
                PDF 발행
              </button>
            </div>
          </div>
          {/* 상담 종료 — 진행 중인 상담이 있을 때만 나타난다. PB 메모와 이 시점의 IPS 를
              그 건에 기록한다. 컴포넌트가 스스로 열린 상담을 찾으므로 고객만 넘긴다. */}
          <ConsultationEndButton client={client} />
        </div>
      )}
    </div>
  );
}

const SIGNAL_KO_REF: Record<string, string> = {
  equity: "주식",
  bond: "채권",
  liquidity: "현금성",
  dollar: "달러",
  gold: "금/원자재",
  risk: "위험관리",
  tax: "세금",
};

// 확정 포트폴리오가 참고한 리포트 — 접었다 펼치는 즉석 열람
function ReferencedReports({
  reports,
  confirmedAt,
}: {
  reports?: Portfolio["referencedReports"];
  confirmedAt?: string;
}) {
  const [open, setOpen] = useState(false);
  const stampLabel = confirmedAt
    ? `확정 시점 기준 스냅샷 · ${new Date(confirmedAt).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" })}`
    : null;
  if (!reports || reports.length === 0) {
    return (
      <p className="mt-3 border-t border-border pt-3 text-[11px] text-fg-muted">
        참고 리포트 기록 없음 (확정 시점에 분석된 리서치가 없었습니다)
      </p>
    );
  }
  return (
    <div className="mt-3 border-t border-border pt-3">
      {stampLabel && (
        <p className="mb-1.5 text-[11px] text-fg-muted">
          🔒 {stampLabel} — 이후 리서치가 바뀌어도 이 기록은 고정됩니다.
        </p>
      )}
      <button
        className="text-sm font-medium text-gold-700 hover:underline dark:text-gold-300"
        onClick={() => setOpen((v) => !v)}
      >
        📑 참고 리포트 {reports.length}건 {open ? "▲" : "▼"}
      </button>
      {open && (
        <ul className="mt-2 space-y-2">
          {reports.map((r, i) => (
            <li key={i} className="rounded-lg border border-border bg-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <span className="text-xs font-medium text-fg">
                  {r.source}
                  {r.date && <span className="ml-2 text-fg-muted">{r.date}</span>}
                </span>
                {r.url && (
                  <a
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-fg-muted underline hover:text-fg"
                  >
                    원문 ↗
                  </a>
                )}
              </div>
              <p className="mt-0.5 text-xs font-semibold text-fg">{r.title}</p>
              {r.summary && <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">{r.summary}</p>}
              {r.signals?.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {r.signals.map((s, j) => (
                    <span
                      key={j}
                      className={`badge text-[10px] ${
                        s.direction > 0
                          ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                          : s.direction < 0
                            ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
                            : "badge-muted"
                      }`}
                      title={s.evidence}
                    >
                      {SIGNAL_KO_REF[s.signal] ?? s.signal}
                      {s.direction > 0 ? "▲" : s.direction < 0 ? "▼" : "·"}
                      {s.strength}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
