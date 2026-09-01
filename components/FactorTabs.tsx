"use client";

// 7요인 카드를 성격별 3개 안쪽 탭으로 묶는다.
//
// 왜 나누나: 7장을 3열 그리드로 늘어놓으면 PB가 "지금 무엇을 보는 중인지"를 잃는다.
// RRTTLLU 는 사실 성격이 다른 세 덩어리다 — 목표(무엇을 원하는가), 제약(무엇이 막는가),
// 자금·세금(언제 얼마가 필요한가). 그 덩어리 단위로 끊는다.
//
// 탭 라벨은 요청받은 "투자 목표 / 제약 조건 / 자금·세금" 을 그대로 쓴다. 대안으로
// "목표·성향 / 제약·규제 / 자금·세금" 도 검토했으나, 탭1에 risk(위험 허용도)가 들어가
// "성향"을 붙이면 바로 위 "고객 투자성향 요약" 패널과 이름이 겹쳐 혼동된다. 지금 라벨이
// 상위 패널과 구분되면서 더 짧다.
//
// 상단 네비 탭(꽉 찬 파란 알약)과 구분하려고 여기는 밑줄 탭으로 만들었다 — 같은 화면에
// 두 층의 탭이 있을 때 시각적으로 층위가 드러나야 한다.

import { useMemo, useState } from "react";
import type { FactorKey, IPS, IPSFactor } from "@/lib/types";
import { FACTOR_META } from "@/lib/types";

interface FactorFlag {
  code: string;
  factor: string;
  text: string;
}

interface Props {
  ips: IPS;
  /** FactorsSummary 가 이미 만든 추론 단서 목록 — 카드 하단 [A-n] 배지에 그대로 쓴다. */
  flags: FactorFlag[];
}

interface FactorGroup {
  id: string;
  label: string;
  /** 탭 아래 한 줄 설명 — 왜 이 요인들이 한 묶음인지. */
  hint: string;
  keys: FactorKey[];
  /** 3개가 한 줄에 들어가야 하는 탭만 3열로. 2개짜리는 2열이 더 읽기 좋다. */
  columns: 2 | 3;
}

const GROUPS: FactorGroup[] = [
  {
    id: "goal",
    label: "투자 목표",
    hint: "무엇을 얼마나, 언제까지 — 포트폴리오 기대치를 정하는 요인",
    keys: ["return", "risk", "timeHorizon"],
    columns: 3,
  },
  {
    id: "constraint",
    label: "제약 조건",
    hint: "실행을 제한하는 요인 — 법·규제와 이 고객만의 사정",
    keys: ["legal", "unique"],
    columns: 2,
  },
  {
    id: "cashTax",
    label: "자금·세금",
    hint: "언제 얼마가 빠져나가는가 — 유동성과 세금 부담",
    keys: ["liquidity", "tax"],
    columns: 2,
  },
];

function scoreBand(score: number | null): { label: string; cls: string } | null {
  if (score == null) return null;
  if (score >= 4) return { label: "상", cls: "bg-gold-200 text-gold-900 dark:bg-gold-700/60 dark:text-gold-100" };
  if (score === 3) return { label: "중", cls: "bg-navy-100 text-navy-800 dark:bg-navy-700 dark:text-navy-100" };
  return { label: "하", cls: "bg-surface-2 text-fg-muted" };
}

function StatusBadge({ f }: { f: IPSFactor }) {
  if (f.status === "explicit") return <span className="badge-gold">명시</span>;
  if (f.status === "inferred") return <span className="badge-navy">추론 🔍</span>;
  return <span className="badge-muted">미언급</span>;
}

export default function FactorTabs({ ips, flags }: Props) {
  const [active, setActive] = useState<string>(GROUPS[0].id);

  // 탭별 미언급 개수 — 탭을 열어보지 않아도 "저기 채울 게 남았다"를 알 수 있어야 한다.
  // 판정 기준은 StatusBadge 와 똑같이 맞춘다(explicit/inferred 가 아니면 미언급).
  const missingByGroup = useMemo(() => {
    const map: Record<string, number> = {};
    for (const g of GROUPS) {
      map[g.id] = g.keys.filter((k) => {
        const status = ips[k]?.status;
        return status !== "explicit" && status !== "inferred";
      }).length;
    }
    return map;
  }, [ips]);

  const group = GROUPS.find((g) => g.id === active) ?? GROUPS[0];

  return (
    <div>
      {/* 안쪽 탭 — 상단 네비(채운 알약)와 달리 밑줄로 층위를 구분한다 */}
      <div
        role="tablist"
        aria-label="7요인 분류"
        className="flex gap-1 overflow-x-auto border-b border-border [scrollbar-width:thin]"
      >
        {GROUPS.map((g) => {
          const isActive = g.id === group.id;
          const missing = missingByGroup[g.id] ?? 0;
          return (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActive(g.id)}
              className={`-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2C3EE8] ${
                isActive
                  ? "border-[#1428A0] font-bold text-[#1428A0]"
                  : "border-transparent text-fg-muted hover:border-border hover:text-fg"
              }`}
            >
              {g.label}
              <span className="text-[10px] text-fg-muted/70">{g.keys.length}</span>
              {missing > 0 && (
                <span
                  title={`미언급 ${missing}개 — 상담으로 채울 수 있습니다`}
                  className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                >
                  미언급 {missing}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-[11px] text-fg-muted">{group.hint}</p>

      <div
        className={`mt-3 grid grid-cols-1 gap-3 ${
          group.columns === 3 ? "md:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-2"
        }`}
      >
        {group.keys.map((key) => {
          const m = FACTOR_META.find((meta) => meta.key === key)!;
          const f = ips[key];
          const band = scoreBand(f.score);
          const flag = flags.find((fl) => fl.factor === m.label);
          return (
            <div key={key} className="card p-4">
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
              {(f.evidence || f.inferenceHint) && (
                <details className="mt-3 border-t border-border pt-2">
                  <summary className="cursor-pointer text-[11px] font-bold text-[#1428A0]">근거 상세 보기</summary>
                  <p className="mt-2 text-xs leading-relaxed text-fg-muted">
                    {f.evidence || `참고: ${f.inferenceHint}`}
                  </p>
                </details>
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
  );
}
