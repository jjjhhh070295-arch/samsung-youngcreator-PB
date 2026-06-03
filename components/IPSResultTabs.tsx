"use client";

import { useMemo, useState } from "react";
import type { IPS, IPSFactor } from "@/lib/types";
import { FACTOR_META } from "@/lib/types";
import IPSRadar from "./IPSRadar";

interface Props {
  ips: IPS;
  onEdit: () => void; // "상담으로 수정"
  onGoPortfolio: () => void; // 포트폴리오 구성으로
}

type Tab = "factors" | "flags" | "questions" | "portfolio";

// 점수 → 상/중/하 밴드
function scoreBand(score: number | null): { label: string; cls: string } | null {
  if (score == null) return null;
  if (score >= 4) return { label: "상", cls: "bg-gold-200 text-gold-900 dark:bg-gold-700/60 dark:text-gold-100" };
  if (score === 3) return { label: "중", cls: "bg-navy-100 text-navy-800 dark:bg-navy-700 dark:text-navy-100" };
  return { label: "하", cls: "bg-surface-2 text-fg-muted" };
}

function StatusBadge({ f }: { f: IPSFactor }) {
  if (f.status === "explicit") return <span className="badge-gold">명시</span>;
  if (f.status === "inferred")
    return (
      <span className="badge-navy">
        추론 <span className="ml-0.5">🔍</span>
      </span>
    );
  return <span className="badge-muted">미언급</span>;
}

export default function IPSResultTabs({ ips, onEdit, onGoPortfolio }: Props) {
  const [tab, setTab] = useState<Tab>("factors");

  // 플래그: 추론 단서가 있는 요인 → 확인 필요 플래그
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

  // 추가질문: 미언급/추론 요인 → 후속 확인 질문
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

  const tabs: { key: Tab; label: string; badge?: number }[] = [
    { key: "factors", label: "7요인" },
    { key: "flags", label: "플래그", badge: flags.length },
    { key: "questions", label: "추가질문", badge: questions.length },
    { key: "portfolio", label: "포트폴리오" },
  ];

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
              className={`flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-navy-800 text-white shadow-sm dark:bg-navy-600"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
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
        <button className="btn-outline ml-auto text-xs" onClick={onEdit}>
          상담으로 수정
        </button>
      </div>

      {/* 7요인 카드 */}
      {tab === "factors" && (
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
                    {band && (
                      <span className={`badge ${band.cls}`}>{band.label}</span>
                    )}
                    <StatusBadge f={f} />
                  </div>
                </div>

                {/* 값 */}
                <p className="mt-3 text-xl font-bold text-navy-700 dark:text-gold-200">
                  {f.value || (
                    <span className="text-base font-normal text-fg-muted">
                      {f.status === "inferred" ? "추론 단서만 있음" : "미언급"}
                    </span>
                  )}
                </p>

                {/* 근거 / 추론 단서 */}
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
                {f.notes && <p className="mt-2 text-xs text-fg-muted">메모: {f.notes}</p>}

                {/* 플래그 콜아웃 */}
                {flag && (
                  <div className="mt-3 rounded-md bg-gold-50 px-3 py-2 text-xs text-gold-800 dark:bg-gold-900/30 dark:text-gold-200">
                    <b>[{flag.code}]</b> {flag.text}
                  </div>
                )}
              </div>
            );
          })}
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

      {/* 포트폴리오 (다음 단계) */}
      {tab === "portfolio" && (
        <div className="card flex flex-col items-center gap-4 p-8 text-center">
          <span className="text-3xl">📊</span>
          <div>
            <p className="text-base font-bold text-fg">다음 단계 — 포트폴리오 구성</p>
            <p className="mt-1 max-w-md text-sm text-fg-muted">
              확정된 7요인 · 현금흐름 · 특이사항을 바탕으로 안정형/균형형/성장형 후보를
              구성하고 스트레스 테스트를 진행합니다.
            </p>
          </div>
          <div className="mb-1 w-full max-w-xs">
            <IPSRadar ips={ips} height={180} />
          </div>
          <button className="btn-gold px-6 py-2.5" onClick={onGoPortfolio}>
            포트폴리오 구성으로 →
          </button>
          <p className="text-[11px] text-fg-muted">참고용 · 투자권유 아님 · PB 검토 전제</p>
        </div>
      )}
    </div>
  );
}
