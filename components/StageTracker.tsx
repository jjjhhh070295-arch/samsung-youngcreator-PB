"use client";

import { useState } from "react";
import type { Client, Stages, StageKey } from "@/lib/types";
import { STAGE_META, FACTOR_KEYS } from "@/lib/types";

interface Props {
  client: Client;
  onChange: (stages: Stages) => Promise<void> | void;
}

// PB가 상담 단계를 하나씩 확정하는 패널.
// 확정 상태(client.stages)는 고객 화면 진행 스텝퍼에 그대로 반영된다.
export default function StageTracker({ client, onChange }: Props) {
  const [saving, setSaving] = useState<StageKey | null>(null);
  const stages = client.stages ?? {};

  // 각 단계의 데이터 현황 힌트
  const reviewedCount = FACTOR_KEYS.filter((k) => client.ips[k].reviewed).length;
  const hint: Record<StageKey, string> = {
    basic: `${client.name} · ${client.clientType === "corporate" ? "법인" : "개인"}`,
    factors: reviewedCount > 0 ? `검토 확정 ${reviewedCount}개` : "아직 확정된 요인 없음",
    cashflow: client.cashFlows.length > 0 ? `${client.cashFlows.length}건 입력됨` : "입력 없음",
    portfolio: client.portfolios.length > 0 ? `후보 ${client.portfolios.length}개` : "생성 안 됨 (더미)",
    stress: "더미 시나리오 사용",
    ips: "더미 출력",
  };

  const toggle = async (key: StageKey) => {
    setSaving(key);
    try {
      await onChange({ ...stages, [key]: !stages[key] });
    } finally {
      setSaving(null);
    }
  };

  const doneCount = STAGE_META.filter((s) => stages[s.key]).length;

  return (
    <div className="card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-bold text-fg">상담 단계 진행</h2>
        <span className="text-xs text-fg-muted">
          확정 <b className="text-gold-600 dark:text-gold-300">{doneCount}</b> / {STAGE_META.length}
        </span>
      </div>

      <ol className="space-y-2">
        {STAGE_META.map((s, i) => {
          const done = !!stages[s.key];
          return (
            <li
              key={s.key}
              className={`flex items-center gap-3 rounded-lg border p-3 transition-colors ${
                done ? "border-gold-400 bg-gold-50 dark:bg-gold-900/20" : "border-border"
              }`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                  done ? "bg-gold-500 text-navy-900" : "bg-surface-2 text-fg-muted"
                }`}
              >
                {done ? "✓" : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-fg">{s.label}</p>
                <p className="truncate text-xs text-fg-muted">
                  {s.desc} · {hint[s.key]}
                </p>
              </div>
              <button
                className={done ? "btn-outline text-xs" : "btn-gold text-xs"}
                onClick={() => toggle(s.key)}
                disabled={saving === s.key}
              >
                {saving === s.key ? "저장…" : done ? "확정 해제" : "확정"}
              </button>
            </li>
          );
        })}
      </ol>

      <p className="mt-3 text-[11px] text-fg-muted">
        각 단계를 [확정]하면 고객 화면의 진행 현황에 반영됩니다. (스트레스·IPS 문서는 현재 더미)
      </p>
    </div>
  );
}
