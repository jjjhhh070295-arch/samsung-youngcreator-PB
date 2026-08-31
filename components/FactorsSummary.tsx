"use client";

// 기본 정보 화면에 들어가는 7요인 요약 — 예전 IPSResultTabs "factors" 탭에서 그대로 옮겨왔다.
// ConsultationHub(상담 검토·승인 워크플로우)는 성격이 달라 여기 포함하지 않는다 — 나머지
// analysis 탭들에만 남아있다.

import { useMemo } from "react";
import type { Client, IPSFactor, StageKey } from "@/lib/types";
import { FACTOR_META } from "@/lib/types";
import IPSRadar from "./IPSRadar";
import ScoreRubricButton from "./ScoreRubricButton";
import HeritageSignalBadge from "./HeritageSignalBadge";

interface Props {
  client: Client;
  allClients: Client[];
  onEdit: () => void;
  onToggleStage: (key: StageKey) => Promise<void> | void;
}

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

export default function FactorsSummary({ client, allClients, onEdit, onToggleStage }: Props) {
  const ips = client.ips;

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

  return (
    <div>
      <HeritageSignalBadge client={client} allClients={allClients} />
      <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
        <ScoreRubricButton
          label="요인 점수 기준표 확인"
          className="shrink-0 whitespace-nowrap rounded-md border border-border bg-surface px-2.5 py-1 text-[11px] font-bold text-fg-muted transition-colors hover:border-gold-400 hover:text-gold-700"
        />
        <button className="btn-outline text-xs" onClick={onEdit}>
          상담으로 7요인 수정
        </button>
        <button
          className={client.stages?.factors ? "btn-outline whitespace-nowrap text-xs" : "btn-gold whitespace-nowrap text-xs"}
          onClick={() => onToggleStage("factors")}
        >
          {client.stages?.factors ? "단계 완료됨 ✓ (해제)" : "이 단계 완료로 표시"}
        </button>
      </div>
      <section className="mb-4 grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="console-panel p-4"><p className="decision-kicker">RRTTLLU profile</p><h2 className="mt-1 text-lg font-black text-fg">고객 투자성향 요약</h2><IPSRadar ips={ips} height={230} /></div>
        <div className="console-panel p-4"><div className="flex items-center justify-between"><div><p className="console-label">최종 투자성향</p><p className="mt-1 text-2xl font-black text-[#1428A0]">{ips.risk.value || "검토 필요"}</p></div><span className="badge-navy">7요인 분석</span></div><div className="mt-4 grid grid-cols-3 gap-2"><div className="console-metric"><p className="console-label">목표수익률</p><p className="mt-1 text-sm font-bold text-fg">{ips.return.value || "미입력"}</p></div><div className="console-metric"><p className="console-label">위험허용도</p><p className="mt-1 text-sm font-bold text-fg">{ips.risk.value || "미입력"}</p></div><div className="console-metric"><p className="console-label">투자기간</p><p className="mt-1 text-sm font-bold text-fg">{ips.timeHorizon.value || "미입력"}</p></div></div><p className="mt-4 text-xs leading-relaxed text-fg-muted">세부 근거와 추론 단서는 아래 요인 카드에서 확인하고 상담으로 수정할 수 있습니다.</p></div>
      </section>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {FACTOR_META.map((m) => {
        const f = ips[m.key];
        const band = scoreBand(f.score);
        const flag = flags.find((fl) => fl.factor === m.label);
        return (
          <div key={m.key} className="card p-4">
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
            {(f.evidence || f.inferenceHint) && <details className="mt-3 border-t border-border pt-2"><summary className="cursor-pointer text-[11px] font-bold text-[#1428A0]">근거 상세 보기</summary><p className="mt-2 text-xs leading-relaxed text-fg-muted">{f.evidence || `참고: ${f.inferenceHint}`}</p></details>}
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
  );
}
