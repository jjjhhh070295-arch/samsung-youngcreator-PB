"use client";

import { useMemo, useState } from "react";
import type { Client, IPSFactor, CashFlow, Portfolio, StageKey } from "@/lib/types";
import { FACTOR_META, computeStages } from "@/lib/types";
import CashFlowEditor from "./CashFlowEditor";
import PortfolioPanel from "./PortfolioPanel";
import StressTestPanel from "./StressTestPanel";

interface Props {
  client: Client;
  onEdit: () => void; // 7요인 수정 (상담 모달)
  onSaveCashFlows: (flows: CashFlow[]) => Promise<void> | void;
  onSavePortfolios: (portfolios: Portfolio[]) => Promise<void> | void;
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
  onEdit,
  onSaveCashFlows,
  onSavePortfolios,
  onToggleStage,
}: Props) {
  const ips = client.ips;
  const [tab, setTab] = useState<Tab>("factors");
  const done = computeStages(client);

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
      className={client.stages?.[k] ? "btn-outline text-xs" : "btn-gold text-xs"}
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
          <div className="mb-3 flex items-center justify-end">
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

      {/* 포트폴리오 — 탭 안에서 직접 생성·편집 */}
      {tab === "portfolio" && (
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="rounded-lg border border-gold-400/60 bg-gold-50 px-3 py-2 text-[11px] text-gold-800 dark:bg-gold-900/20 dark:text-gold-200">
              참고용 · 투자권유 아님 · PB 검토 전제. 산출값은 현재 더미입니다.
            </p>
            <StageToggle k="portfolio" />
          </div>
          <PortfolioPanel client={client} onSave={onSavePortfolios} />
        </div>
      )}

      {/* 스트레스 — 탭 안에서 직접 실행 + 단계 확정 */}
      {tab === "stress" && (
        <div>
          <div className="mb-3 flex items-center justify-end">
            <StageToggle k="stress" />
          </div>
          <StressTestPanel portfolios={client.portfolios} />
        </div>
      )}

      {/* IPS — 더미 + 단계 확정 */}
      {tab === "ips" && (
        <div>
          <div className="mb-3 flex items-center justify-end">
            <StageToggle k="ips" />
          </div>
          <div className="card flex flex-col items-center gap-3 p-8 text-center">
            <span className="text-3xl">📄</span>
            <p className="text-base font-bold text-fg">IPS 문서 (투자정책서)</p>
            <p className="max-w-md text-sm text-fg-muted">
              7요인·포트폴리오를 반영한 투자정책서를 정리합니다. PDF 출력은 추후 제공(더미).
              완료로 표시하면 고객 화면 진행 현황에 반영됩니다.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
