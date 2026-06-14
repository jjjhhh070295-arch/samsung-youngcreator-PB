"use client";

import type { IPS, IPSFactor, FactorKey, FactorStatus } from "@/lib/types";
import { FACTOR_META } from "@/lib/types";

interface Props {
  ips: IPS;
  readOnly: boolean;
  onChange: (key: FactorKey, factor: IPSFactor) => void;
}

const STATUS_LABEL: Record<FactorStatus, string> = {
  explicit: "직접 근거",
  inferred: "추론 단서",
  empty: "미언급",
};

function StatusBadge({ status }: { status: FactorStatus }) {
  const cls =
    status === "explicit"
      ? "badge-gold"
      : status === "inferred"
        ? "badge-navy"
        : "badge-muted";
  return <span className={cls}>{STATUS_LABEL[status]}</span>;
}

// RRTTLLU 7요인 편집 폼.
// readOnly=true 면 잠금(읽기 전용). 부모가 [저장 확정]/[수정]으로 토글한다.
export default function IPSForm({ ips, readOnly, onChange }: Props) {
  const update = (key: FactorKey, patch: Partial<IPSFactor>) => {
    onChange(key, { ...ips[key], ...patch });
  };

  return (
    <div className="space-y-3">
      {FACTOR_META.map((m) => {
        const f = ips[m.key];
        const valuePlaceholder =
          m.key === "unique"
            ? "예: 세금을 최대한 적게 내고 싶음, 해외주식 단일종목만 편입, 기대수익률 20% 이상 희망"
            : m.key === "tax"
              ? "예: 연금저축/IRP 세액공제, 법인세·증여세 납부일 고려"
              : "예: 연 6~8%";
        return (
          <div key={m.key} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded bg-navy-800 text-xs font-bold text-gold-300 dark:bg-navy-600">
                  {m.letter}
                </span>
                <div>
                  <p className="text-sm font-semibold text-fg">{m.label}</p>
                  <p className="text-[11px] text-fg-muted">{m.desc}</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={f.source === "ai" ? "badge-navy" : "badge-muted"}>
                  {f.source === "ai" ? "AI" : "수동"}
                </span>
                <StatusBadge status={f.status} />
              </div>
            </div>

            {/* 상태 선택 (편집 가능 시) */}
            {!readOnly && (
              <div className="mt-3 flex gap-1">
                {(["explicit", "inferred", "empty"] as FactorStatus[]).map((s) => (
                  <button
                    key={s}
                    onClick={() =>
                      update(m.key, {
                        status: s,
                        // empty/inferred 로 바꾸면 점수 제거(과대계상 방지)
                        score: s === "explicit" ? f.score : null,
                        source: "manual",
                      })
                    }
                    className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                      f.status === s
                        ? "bg-navy-800 text-white dark:bg-navy-600"
                        : "bg-surface-2 text-fg-muted hover:text-fg"
                    }`}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                ))}
              </div>
            )}

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {/* 값 */}
              <div className="sm:col-span-2">
                <label className="label">값 / 설명</label>
                {readOnly ? (
                  <p className="min-h-[2.25rem] rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg">
                    {f.value || <span className="text-fg-muted">미언급</span>}
                  </p>
                ) : (
                  <input
                    className="input"
                    value={f.value}
                    placeholder={f.status === "empty" ? "(공백 허용)" : valuePlaceholder}
                    disabled={f.status === "empty"}
                    onChange={(e) => update(m.key, { value: e.target.value, source: "manual" })}
                  />
                )}
              </div>

              {/* 점수 (explicit만) */}
              <div>
                <label className="label">점수 (1~5)</label>
                {f.status !== "explicit" ? (
                  <p className="min-h-[2.25rem] rounded-lg bg-surface-2 px-3 py-2 text-sm text-fg-muted">
                    {f.status === "inferred" ? "추론 — 점수 없음" : "—"}
                  </p>
                ) : readOnly ? (
                  <p className="min-h-[2.25rem] rounded-lg bg-surface-2 px-3 py-2 text-sm font-semibold text-gold-600 dark:text-gold-300">
                    {f.score != null ? `${f.score}점` : "—"}
                  </p>
                ) : (
                  <select
                    className="input"
                    value={f.score ?? ""}
                    onChange={(e) =>
                      update(m.key, {
                        score: e.target.value ? Number(e.target.value) : null,
                        source: "manual",
                      })
                    }
                  >
                    <option value="">선택</option>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}점
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* explicit: 근거 인용 */}
            {f.status === "explicit" && (f.evidence || !readOnly) && (
              <div className="mt-2">
                <label className="label">근거 구절 (상담 원문 인용)</label>
                {readOnly ? (
                  f.evidence ? (
                    <blockquote className="border-l-2 border-gold-400 bg-surface-2 px-3 py-2 text-xs italic text-fg-muted">
                      “{f.evidence}”
                    </blockquote>
                  ) : (
                    <p className="text-xs text-fg-muted">근거 미입력</p>
                  )
                ) : (
                  <input
                    className="input text-xs"
                    value={f.evidence}
                    placeholder="점수 근거가 된 상담 원문 구절"
                    onChange={(e) => update(m.key, { evidence: e.target.value })}
                  />
                )}
              </div>
            )}

            {/* inferred: 추론 단서 (회색 참고 힌트) */}
            {f.status === "inferred" && (
              <div className="mt-2">
                <label className="label">추론 단서 (참고용 · 점수 미반영)</label>
                {readOnly ? (
                  <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-fg-muted">
                    참고: {f.inferenceHint || "—"}
                  </p>
                ) : (
                  <input
                    className="input text-xs"
                    value={f.inferenceHint}
                    placeholder="직접 근거는 없지만 정황상 단서가 되는 내용"
                    onChange={(e) => update(m.key, { inferenceHint: e.target.value })}
                  />
                )}
              </div>
            )}

            {/* 메모 + 검토확정 */}
            <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
              <div className="min-w-[60%] flex-1">
                <label className="label">메모</label>
                {readOnly ? (
                  <p className="text-xs text-fg-muted">{f.notes || "—"}</p>
                ) : (
                  <input
                    className="input text-xs"
                    value={f.notes}
                    placeholder="상세 메모 (선택)"
                    onChange={(e) => update(m.key, { notes: e.target.value })}
                  />
                )}
              </div>
              <label
                className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  f.reviewed
                    ? "border-gold-400 bg-gold-50 text-gold-700 dark:bg-gold-900/30 dark:text-gold-200"
                    : "border-border text-fg-muted"
                } ${readOnly ? "pointer-events-none opacity-70" : ""}`}
              >
                <input
                  type="checkbox"
                  className="accent-gold-500"
                  checked={f.reviewed}
                  disabled={readOnly}
                  onChange={(e) => update(m.key, { reviewed: e.target.checked })}
                />
                검토 확정
              </label>
            </div>
          </div>
        );
      })}
    </div>
  );
}
