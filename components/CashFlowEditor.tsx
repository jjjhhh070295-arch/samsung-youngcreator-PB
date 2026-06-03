"use client";

import { useState } from "react";
import type { CashFlow } from "@/lib/types";
import { formatKRW, parseNumber } from "@/lib/format";
import { EmptyView } from "./StateViews";

interface Props {
  cashFlows: CashFlow[];
  onSave: (flows: CashFlow[]) => Promise<void> | void;
}

function uid() {
  return "cf-" + Math.random().toString(36).slice(2, 9);
}

// 현금흐름 입력 (포트폴리오 산출 입력값). 추가/수정/삭제 후 [저장].
export default function CashFlowEditor({ cashFlows, onSave }: Props) {
  const [rows, setRows] = useState<CashFlow[]>(cashFlows);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const mutate = (next: CashFlow[]) => {
    setRows(next);
    setDirty(true);
  };

  const add = () =>
    mutate([
      ...rows,
      { id: uid(), label: "", amount: 0, date: "", recurring: false },
    ]);

  const update = (id: string, patch: Partial<CashFlow>) =>
    mutate(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const remove = (id: string) => mutate(rows.filter((r) => r.id !== id));

  const save = async () => {
    setSaving(true);
    try {
      await onSave(rows);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  const total = rows.reduce((s, r) => s + (r.amount || 0), 0);

  return (
    <div>
      {rows.length === 0 ? (
        <EmptyView
          title="등록된 현금흐름이 없어요"
          hint="급여·주택구입·학자금 등 예상 유입/유출을 추가하세요. 포트폴리오 산출 입력값입니다."
          action={
            <button className="btn-gold text-sm" onClick={add}>
              + 현금흐름 추가
            </button>
          }
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-2 text-xs text-fg-muted">
              <tr>
                <th className="px-3 py-2 text-left">항목</th>
                <th className="px-3 py-2 text-right">금액 (원, 유출은 음수)</th>
                <th className="px-3 py-2 text-left">시점</th>
                <th className="px-3 py-2 text-center">정기</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border/60 last:border-0">
                  <td className="px-3 py-2">
                    <input
                      className="input"
                      value={r.label}
                      placeholder="예: 급여"
                      onChange={(e) => update(r.id, { label: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      className="input text-right"
                      inputMode="numeric"
                      value={r.amount || ""}
                      placeholder="0"
                      onChange={(e) => update(r.id, { amount: parseNumber(e.target.value) })}
                    />
                    <p
                      className={`mt-0.5 text-right text-[11px] ${
                        r.amount < 0 ? "text-red-500" : "text-gold-600 dark:text-gold-300"
                      }`}
                    >
                      {r.amount ? formatKRW(r.amount) : "—"}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="month"
                      className="input"
                      value={r.date}
                      onChange={(e) => update(r.id, { date: e.target.value })}
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <input
                      type="checkbox"
                      className="accent-gold-500"
                      checked={r.recurring}
                      onChange={(e) => update(r.id, { recurring: e.target.checked })}
                    />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      className="btn-ghost h-7 px-2 text-xs text-red-500"
                      onClick={() => remove(r.id)}
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button className="btn-outline text-sm" onClick={add}>
            + 현금흐름 추가
          </button>
          <div className="flex items-center gap-3">
            <span className="text-xs text-fg-muted">
              순합계 <b className="text-fg">{formatKRW(total)}</b>
            </span>
            <button className="btn-gold text-sm" onClick={save} disabled={!dirty || saving}>
              {saving ? "저장 중…" : dirty ? "현금흐름 저장" : "저장됨"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
