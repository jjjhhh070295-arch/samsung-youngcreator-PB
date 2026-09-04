"use client";

// 7요인 카드를 성격별 3열로 나란히 배치한다.
//
// 왜 나누나: 7장을 균일한 3열 그리드로 흘려보내면 카드가 성격과 무관하게 줄바꿈돼
// PB가 "지금 무엇을 보는 중인지"를 잃는다. RRTTLLU 는 사실 성격이 다른 세 덩어리다 —
// 목표(무엇을 원하는가), 제약(무엇이 막는가), 자금·세금(언제 얼마가 필요한가).
// 열 자체를 그 덩어리로 고정하면 위치가 곧 의미가 된다.
//
// 탭이 아니라 열로 두는 이유: 세 그룹을 동시에 봐야 상담 중에 비교가 된다.
// 탭이면 전환 비용이 들고, 어느 탭에 무엇이 있었는지 기억해야 한다.
//
// 열 높이는 맞추지 않는다 — 1열은 카드 3장, 나머지는 2장이라 자연히 다르다.
// grid 에 items-start 를 줘서 각 열이 제 높이대로 끝나게 하고, 카드에는 높이를 강제하지
// 않는다(억지로 맞추면 짧은 카드에 빈 공간이 생겨 오히려 읽기 나빠진다).
//
// "투자 목표"만 요인이 3개라 다른 두 그룹(2개)보다 한 줄 더 길었다 — 위험 허용도·투자
// 기간을 한 줄에 나란히 묶는 "쌍 라인"으로 접어 세 박스 높이를 맞춘다. 쌍은 그룹 정의의
// rows 에 [FactorKey, FactorKey] 튜플로 선언하고, 렌더러는 그 모양만 보고 반응한다 —
// 특정 요인 이름을 렌더러에 하드코딩하지 않는다.

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

// 그룹 한 줄 = 요인 하나, 또는 폭을 아끼려고 요인 둘을 나란히 묶은 쌍.
type FactorRow = FactorKey | readonly [FactorKey, FactorKey];

interface FactorGroup {
  id: string;
  label: string;
  /** 그룹 제목 아래 한 줄 설명 — 왜 이 요인들이 한 묶음인지. */
  hint: string;
  rows: FactorRow[];
}

const GROUPS: FactorGroup[] = [
  {
    id: "goal",
    label: "투자 목표",
    hint: "무엇을 얼마나, 언제까지",
    rows: ["return", ["risk", "timeHorizon"]],
  },
  {
    id: "constraint",
    label: "제약 조건",
    hint: "실행을 제한하는 요인",
    rows: ["legal", "unique"],
  },
  {
    id: "cashTax",
    label: "자금·세금",
    hint: "언제 얼마가 빠져나가는가",
    rows: ["liquidity", "tax"],
  },
];

// 쌍 라인은 폭이 절반이라, 원래 영문 설명이 한 줄에 안 들어가는 요인만 축약형으로 덮어쓴다.
const PAIR_DESC_OVERRIDE: Partial<Record<FactorKey, string>> = {
  risk: "Risk — 감내 위험",
};

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

function factorFlag(flags: FactorFlag[], label: string) {
  return flags.find((fl) => fl.factor === label);
}

/** 단독 요인 줄 — 기존 레이아웃 그대로(근거는 그 줄 안에서 details 로 펼친다). */
function FactorLine({ factorKey, ips, flags }: { factorKey: FactorKey; ips: IPS; flags: FactorFlag[] }) {
  const m = FACTOR_META.find((meta) => meta.key === factorKey)!;
  const f = ips[factorKey];
  const band = scoreBand(f.score);
  const flag = factorFlag(flags, m.label);
  const valueTone =
    f.status === "explicit"
      ? "text-lg font-bold text-navy-700 dark:text-gold-200"
      : f.status === "inferred"
        ? "text-base font-semibold text-fg"
        : "text-base font-normal text-fg-muted";
  const valueText = f.value || (f.status === "inferred" ? "추론 단서만 있음" : "미언급");

  return (
    <div className="py-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-base font-bold text-fg">{m.label}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          {band && <span className={`badge ${band.cls}`}>{band.label}</span>}
          <StatusBadge f={f} />
        </div>
      </div>
      <p className="mt-1 text-[11px] text-fg-muted">{m.desc}</p>
      <p className={`mt-2 line-clamp-2 break-words ${valueTone}`} title={valueText}>{valueText}</p>
      {(f.evidence || f.inferenceHint) && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] font-bold text-[#1428A0]">▸ 근거 상세 보기</summary>
          <div className="mt-2 border-l-2 border-[#1428A0] pl-3">
            <p className="text-xs leading-relaxed text-fg-muted">
              {f.evidence || `참고: ${f.inferenceHint}`}
            </p>
          </div>
        </details>
      )}
      {flag && (
        <div className="mt-2 rounded-md bg-gold-50 px-3 py-2 text-xs text-gold-800 dark:bg-gold-900/30 dark:text-gold-200">
          <b>[{flag.code}]</b> {flag.text}
        </div>
      )}
    </div>
  );
}

/**
 * 쌍 라인의 절반 칸 — 밀도를 낮춘 압축판이다. 근거는 여기서 펼치지 않는다(반 칸 폭에
 * 가두면 읽기 어렵다) — 토글만 여기 두고, 실제 내용은 쌍 라인 전체 폭 아래에 그린다.
 */
function FactorLineCompact({
  factorKey,
  ips,
  flags,
  evidenceOpen,
  onToggleEvidence,
}: {
  factorKey: FactorKey;
  ips: IPS;
  flags: FactorFlag[];
  evidenceOpen: boolean;
  onToggleEvidence: () => void;
}) {
  const m = FACTOR_META.find((meta) => meta.key === factorKey)!;
  const f = ips[factorKey];
  const band = scoreBand(f.score);
  const flag = factorFlag(flags, m.label);
  const desc = PAIR_DESC_OVERRIDE[factorKey] ?? m.desc;
  const valueTone =
    f.status === "explicit"
      ? "text-base font-bold leading-snug text-navy-700 dark:text-gold-200"
      : f.status === "inferred"
        ? "text-sm font-semibold leading-snug text-fg"
        : "text-sm font-normal leading-snug text-fg-muted";
  const valueText = f.value || (f.status === "inferred" ? "추론 단서만 있음" : "미언급");
  const hasEvidence = !!(f.evidence || f.inferenceHint);

  return (
    <div className="min-w-0">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-bold text-fg">{m.label}</p>
        <div className="flex shrink-0 items-center gap-1.5">
          {band && <span className={`badge ${band.cls}`}>{band.label}</span>}
          {/* 쌍 라인에서는 '명시' 칩은 숨긴다 — 레벨(상/중/하)·추론 칩만 남긴다. */}
          {f.status !== "explicit" && <StatusBadge f={f} />}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-fg-muted">{desc}</p>
      <p className={`mt-2 line-clamp-2 break-words ${valueTone}`} title={valueText}>{valueText}</p>
      {hasEvidence && (
        <button
          type="button"
          onClick={onToggleEvidence}
          aria-expanded={evidenceOpen}
          className="mt-2 cursor-pointer text-[11px] font-bold text-[#1428A0]"
        >
          {evidenceOpen ? "▾" : "▸"} 근거
        </button>
      )}
      {flag && (
        <div className="mt-2 rounded-md bg-gold-50 px-3 py-2 text-xs text-gold-800 dark:bg-gold-900/30 dark:text-gold-200">
          <b>[{flag.code}]</b> {flag.text}
        </div>
      )}
    </div>
  );
}

/** 쌍 라인에서 펼쳐진 근거 — 전체 폭, 어느 요인 근거인지 머리에 이름을 붙인다. */
function PairEvidence({ factorKey, ips, flags }: { factorKey: FactorKey; ips: IPS; flags: FactorFlag[] }) {
  const m = FACTOR_META.find((meta) => meta.key === factorKey)!;
  const f = ips[factorKey];
  if (!(f.evidence || f.inferenceHint)) return null;
  const flag = factorFlag(flags, m.label);
  const heading = flag ? `[${flag.code}] ${m.label}` : m.label;
  return (
    <div className="mt-2 border-l-2 border-[#1428A0] pl-3">
      <p className="text-xs leading-relaxed text-fg-muted">
        <b className="text-fg">{heading}</b> — {f.evidence || `참고: ${f.inferenceHint}`}
      </p>
    </div>
  );
}

export default function FactorGroups({ ips, flags }: Props) {
  // 쌍 라인 근거 펼침 상태 — FactorKey 는 그룹을 넘나들어도 값이 겹치지 않으니 단일 Set 로 충분.
  const [openPairEvidence, setOpenPairEvidence] = useState<Set<FactorKey>>(new Set());
  const togglePairEvidence = (key: FactorKey) => {
    setOpenPairEvidence((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const flatKeys = (rows: FactorRow[]): FactorKey[] =>
    rows.flatMap((r) => (Array.isArray(r) ? r : [r as FactorKey]));

  // 그룹별 미언급 개수 — 판정 기준은 StatusBadge 와 똑같이 맞춘다
  // (explicit/inferred 가 아니면 미언급).
  const missingByGroup = useMemo(() => {
    const map: Record<string, number> = {};
    for (const g of GROUPS) {
      map[g.id] = flatKeys(g.rows).filter((k) => {
        const status = ips[k]?.status;
        return status !== "explicit" && status !== "inferred";
      }).length;
    }
    return map;
  }, [ips]);

  return (
    // items-start — 열마다 카드 수가 달라 높이가 다르다. stretch 되면 짧은 열이
    // 늘어나면서 카드 아래 빈 공간이 생기므로 각 열이 제 높이대로 끝나게 한다.
    <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
      {GROUPS.map((g) => {
        const missing = missingByGroup[g.id] ?? 0;
        const factorCount = flatKeys(g.rows).length;
        return (
          // 그룹 박스 — 박스 경계가 분명히 보이게 기존 border-border보다 진한
          // 남색(#1428A0, ControlStatusBar 등 다른 강조 박스와 동일 톤)을 쓴다.
          <section key={g.id} className="min-w-0 overflow-hidden rounded-xl border-[1.5px] border-[#1428A0] bg-white">
            {/* 헤더 띠 — 박스 안에 꽉 채운 남색 바 */}
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 bg-[#1428A0] px-4 py-2.5">
              <div className="flex items-baseline gap-1.5">
                <h3 className="text-sm font-black text-white">{g.label}</h3>
                <span className="text-[10px] text-white/60">{factorCount}</span>
              </div>
              {missing > 0 && (
                <span title={`미언급 ${missing}개 — 상담으로 채울 수 있습니다`} className="badge-warning">
                  미언급 {missing}
                </span>
              )}
            </div>
            {/* 그룹 설명 + 구분선 */}
            <div className="border-b border-border px-4 pb-2.5 pt-2">
              <p className="text-[11px] text-fg-muted">{g.hint}</p>
            </div>

            {/* 요인 줄 — 카드 테두리 없이 얇은 구분선으로만 나눈다(divide-y라 마지막 줄엔 안 붙는다) */}
            <div className="divide-y divide-border px-4">
              {g.rows.map((row) => {
                if (!Array.isArray(row)) {
                  const key = row as FactorKey;
                  return <FactorLine key={key} factorKey={key} ips={ips} flags={flags} />;
                }
                const pair = row as readonly [FactorKey, FactorKey];
                return (
                  <div key={pair.join("-")} className="py-3">
                    {/* 좌우 분할 — 오른쪽 칸 왼쪽에만 구분선. 좁아지면 1열로 떨어진다. */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-x-4">
                      {pair.map((key, idx) => (
                        <div key={key} className={idx === 1 ? "min-w-0 sm:border-l sm:border-border sm:pl-4" : "min-w-0"}>
                          <FactorLineCompact
                            factorKey={key}
                            ips={ips}
                            flags={flags}
                            evidenceOpen={openPairEvidence.has(key)}
                            onToggleEvidence={() => togglePairEvidence(key)}
                          />
                        </div>
                      ))}
                    </div>
                    {pair.map((key) =>
                      openPairEvidence.has(key) ? (
                        <PairEvidence key={`${key}-evidence`} factorKey={key} ips={ips} flags={flags} />
                      ) : null,
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
