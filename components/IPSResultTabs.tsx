"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Client, IPSFactor, CashFlow, Portfolio, StageKey } from "@/lib/types";
import { FACTOR_META, computeStages } from "@/lib/types";
import CashFlowEditor from "./CashFlowEditor";
import PortfolioPanel from "./PortfolioPanel";
import StressTestPanel from "./StressTestPanel";
import ScoreRubricButton from "./ScoreRubricButton";

interface Props {
  client: Client;
  pbId: string;
  clientId: string;
  onEdit: () => void; // 7요인 수정 (상담 모달)
  onSaveCashFlows: (flows: CashFlow[]) => Promise<void> | void;
  onSavePortfolios: (portfolios: Portfolio[]) => Promise<void> | void;
  onFinalizePortfolio: (portfolio: Portfolio) => Promise<void> | void; // 최종 확정(저장+단계)
  onUnfinalizePortfolio: () => Promise<void> | void; // 확정 해제
  onToggleStage: (key: StageKey) => Promise<void> | void; // 스트레스/IPS 완료 토글
}

type Tab =
  | "basic"
  | "factors"
  | "flags"
  | "questions"
  | "cashflow"
  | "portfolio"
  | "stress"
  | "ips";

function scoreBand(score: number | null): { label: string; cls: string } | null {
  if (score == null) return null;
  if (score >= 4) return { label: "상", cls: "bg-gold-200 text-gold-900 dark:bg-gold-700/60 dark:text-gold-100" };
  if (score === 3) return { label: "중", cls: "bg-navy-100 text-navy-800 dark:bg-navy-700 dark:text-navy-100" };
  return { label: "하", cls: "bg-surface-2 text-fg-muted" };
}

function StatusBadge({ f }: { f: IPSFactor }) {
  if (f.status === "explicit") return <span className="badge-gold">명시</span>;
  if (f.status === "inferred")
    return <span className="badge-navy">추론 🔍</span>;
  return <span className="badge-muted">미언급</span>;
}

// 상담 전 과정을 하나의 탭 바로 — 7요인/플래그/추가질문/현금흐름/포트폴리오/스트레스/IPS
export default function IPSResultTabs({
  client,
  pbId,
  clientId,
  onEdit,
  onSaveCashFlows,
  onSavePortfolios,
  onFinalizePortfolio,
  onUnfinalizePortfolio,
  onToggleStage,
}: Props) {
  const router = useRouter();
  const ips = client.ips;
  const [tab, setTab] = useState<Tab>("factors");
  const done = computeStages(client);

  // 포트폴리오 패널에서 현재 선택·편집 중인 포트폴리오 (최종 확정 저장용)
  const [chosen, setChosen] = useState<Portfolio | null>(null);

  const [finalizing, setFinalizing] = useState(false);

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

  const flags = useMemo(() => {
    const list: { code: string; factor: string; text: string }[] = [];
    let i = 1;
    for (const m of FACTOR_META) {
      const f = ips[m.key];
      if (f.status === "inferred" && f.inferenceHint) {
        list.push({ code: `A-${i++}`, factor: m.label, text: f.inferenceHint });
      }
    }
    return list;
  }, [ips]);

  const questions = useMemo(() => {
    const list: { factor: string; text: string }[] = [];
    for (const m of FACTOR_META) {
      const f = ips[m.key];
      if (f.status === "empty") {
        list.push({ factor: m.label, text: `‘${m.label}’ 관련 정보가 없습니다. 고객께 확인이 필요합니다.` });
      } else if (f.status === "inferred") {
        list.push({ factor: m.label, text: `‘${m.label}’은(는) 추론 단서만 있습니다. 직접 확인해 점수를 확정하세요.` });
      }
    }
    return list;
  }, [ips]);

  const tabs: { key: Tab; label: string; badge?: number; done?: boolean }[] = [
    { key: "basic", label: "기본정보", done: done.basic },
    { key: "factors", label: "7요인", done: done.factors },
    { key: "flags", label: "플래그", badge: flags.length },
    { key: "questions", label: "추가질문", badge: questions.length },
    { key: "cashflow", label: "현금흐름", done: done.cashflow },
    { key: "portfolio", label: "포트폴리오", done: done.portfolio },
    { key: "stress", label: "스트레스", done: done.stress },
    { key: "ips", label: "IPS", done: done.ips },
  ];

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
    <div>
      {/* 탭 바 */}
      <div className="mb-4 flex flex-wrap items-center gap-1 rounded-xl border border-border bg-surface-2 p-1">
        {tabs.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors ${
                active ? "bg-navy-800 text-white shadow-sm dark:bg-navy-600" : "text-fg-muted hover:text-fg"
              }`}
            >
              {t.done && <span className={active ? "text-gold-300" : "text-gold-500"}>✓</span>}
              {t.label}
              {t.badge != null && t.badge > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[11px] ${
                    active ? "bg-gold-400 text-navy-900" : "bg-gold-200 text-gold-900"
                  }`}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
        {tab === "factors" && (
          <button className="btn-outline ml-auto text-xs" onClick={onEdit}>
            상담으로 7요인 수정
          </button>
        )}
      </div>

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
                {client.clientType === "corporate" ? "법인" : "개인"}
              </p>
            </div>
            <div>
              <p className="text-xs text-fg-muted">이름</p>
              <p className="text-sm font-semibold text-fg">{client.name}</p>
            </div>
            <div>
              <p className="text-xs text-fg-muted">자산규모</p>
              <p className="text-sm font-semibold text-fg">
                {(client.assetSize / 1_0000_0000).toLocaleString("ko-KR")}억
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 7요인 */}
      {tab === "factors" && (
        <div>
          <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
            <ScoreRubricButton
              label="AI점수 기준표 확인"
              className="shrink-0 whitespace-nowrap rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-bold text-fg-muted transition-colors hover:border-gold-400 hover:text-gold-700"
            />
            <StageToggle k="factors" />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {FACTOR_META.map((m) => {
            const f = ips[m.key];
            const band = scoreBand(f.score);
            const flag = flags.find((fl) => fl.factor === m.label);
            return (
              <div key={m.key} className="card p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-base font-bold text-fg">{m.label}</p>
                    <p className="text-[11px] text-fg-muted">{m.desc}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {band && <span className={`badge ${band.cls}`}>{band.label}</span>}
                    <StatusBadge f={f} />
                  </div>
                </div>
                <p className="mt-3 text-xl font-bold text-navy-700 dark:text-gold-200">
                  {f.value || (
                    <span className="text-base font-normal text-fg-muted">
                      {f.status === "inferred" ? "추론 단서만 있음" : "미언급"}
                    </span>
                  )}
                </p>
                {f.status === "explicit" && f.evidence && (
                  <blockquote className="mt-2 border-l-2 border-gold-400 pl-2 text-xs italic text-fg-muted">
                    {f.evidence}
                  </blockquote>
                )}
                {f.status === "inferred" && f.inferenceHint && (
                  <p className="mt-2 border-l-2 border-navy-300 pl-2 text-xs text-fg-muted">
                    참고: {f.inferenceHint}
                  </p>
                )}
                {flag && (
                  <div className="mt-3 rounded-md bg-gold-50 px-3 py-2 text-xs text-gold-800 dark:bg-gold-900/30 dark:text-gold-200">
                    <b>[{flag.code}]</b> {flag.text}
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </div>
      )}

      {/* 플래그 */}
      {tab === "flags" && (
        <div className="card p-5">
          {flags.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">
              감지된 플래그가 없습니다. (추론 단서가 있는 요인이 여기에 모입니다)
            </p>
          ) : (
            <ul className="space-y-2">
              {flags.map((fl) => (
                <li
                  key={fl.code}
                  className="flex items-start gap-3 rounded-lg border border-gold-300 bg-gold-50 p-3 text-sm dark:border-gold-700 dark:bg-gold-900/20"
                >
                  <span className="badge-gold shrink-0">{fl.code}</span>
                  <span>
                    <b className="text-fg">{fl.factor}</b>
                    <span className="text-fg-muted"> — {fl.text}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 추가질문 */}
      {tab === "questions" && (
        <div className="card p-5">
          {questions.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">
              추가로 확인할 질문이 없습니다. 모든 요인에 직접 근거가 있습니다. 👍
            </p>
          ) : (
            <ul className="space-y-2">
              {questions.map((q, i) => (
                <li key={i} className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
                  <span className="text-gold-500">Q{i + 1}.</span>
                  <span className="text-fg-muted">{q.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 현금흐름 */}
      {tab === "cashflow" && (
        <div>
          <div className="mb-3 flex items-center justify-end">
            <StageToggle k="cashflow" />
          </div>
          <CashFlowEditor cashFlows={client.cashFlows} onSave={onSaveCashFlows} />
        </div>
      )}

      {/* 포트폴리오 — 패널 편집 + 최종 확정 */}
      {tab === "portfolio" && (
        <div>
          <PortfolioPanel client={client} pbId={pbId} clientId={clientId} onSelectionChange={setChosen} />

          {/* 최종 확정 단계 */}
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
              <StressTestPanel portfolios={client.portfolios} />
            </>
          ) : (
            <div className="card flex flex-col items-center gap-2 p-8 text-center">
              <span className="text-2xl">🔒</span>
              <p className="text-sm font-medium text-fg">포트폴리오를 먼저 최종 확정하세요</p>
              <p className="text-xs text-fg-muted">
                포트폴리오 탭에서 최종 확정해야 그 구성으로 스트레스 테스트를 진행할 수 있습니다.
              </p>
              <button className="btn-outline mt-1 text-xs" onClick={() => setTab("portfolio")}>
                포트폴리오 탭으로
              </button>
            </div>
          )}
        </div>
      )}

      {/* IPS — 투자정책서 문서 생성 + 단계 확정 */}
      {tab === "ips" && (
        <div>
          <div className="mb-3 flex items-center justify-end">
            <StageToggle k="ips" />
          </div>
          <div className="card flex flex-col items-center gap-4 p-8 text-center">
            <span className="text-3xl">📄</span>
            <div>
              <p className="text-base font-bold text-fg">투자정책서 (IPS) 문서</p>
              <p className="mt-1 max-w-md text-sm text-fg-muted">
                고객 기본정보 · RRTTLLU 7요인 · 현금흐름 · 확정 포트폴리오를 모아 정식 투자정책서로
                생성합니다. 문서 화면에서 <b>인쇄 / PDF 저장</b>이 가능합니다.
              </p>
            </div>
            {!done.portfolio && (
              <p className="text-xs text-fg-muted">
                💡 포트폴리오를 최종 확정하면 문서에 포트폴리오 내역도 함께 채워집니다.
              </p>
            )}
            <button
              className="btn-gold px-6 py-2.5"
              onClick={() => router.push(`/pb/${pbId}/${clientId}/ips`)}
            >
              IPS 문서 생성 / 인쇄 →
            </button>
          </div>
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
