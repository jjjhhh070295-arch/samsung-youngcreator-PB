"use client";

import { GOLD_CASES, evaluateGoldSet } from "@/lib/advisory/goldSet";

export default function JudgeTrustPanel() {
  const ev = evaluateGoldSet();
  return (
    <div className="card space-y-3 p-4">
      <div>
        <h3 className="text-sm font-bold text-fg">검토 기준 점검</h3>
        <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
          아래 라벨은 사람이 미리 붙인 정답입니다. 검토 기준이 스스로 정답을 만들지 않습니다.
          일치율 {ev.agreementPct}%이며 100%가 아닙니다. 불일치와 한계를 그대로 표시합니다.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 text-center text-xs md:grid-cols-4">
        <Stat label="사람 통과 · 검토 통과" value={ev.tp} />
        <Stat label="사람 차단 · 검토 차단" value={ev.tn} />
        <Stat label="오탐 (사람 차단, 검토 통과)" value={ev.fp} tone="text-red-600" />
        <Stat label="미탐 (사람 통과, 검토 차단)" value={ev.fn} tone="text-amber-700" />
      </div>
      <p className="text-xs text-fg-muted">샘플 {GOLD_CASES.length}건 (운영 실패 유형 2건 포함: 인용 정보 없음, 출처 식별값 누락)</p>
      {ev.disagreements.length > 0 ? (
        <div>
          <p className="text-xs font-semibold text-fg">불일치 사례</p>
          <ul className="mt-1 space-y-1 text-[11px] text-fg-muted">
            {ev.disagreements.map((d) => (
              <li key={d.id}>
                {d.id} {d.title} · 사람 {d.human} / 검토 {d.judge} · {d.notes}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-[11px] text-fg-muted">
          이 샘플 세트에서는 불일치가 없습니다. 운영 데이터에서는 불일치가 생길 수 있으며, 그 경우 고객용 PDF를 발행하지 않습니다.
        </p>
      )}
      <div className="max-h-48 overflow-auto rounded-lg border border-border">
        <table className="w-full text-[11px]">
          <thead className="bg-surface-2 text-fg-muted">
            <tr>
              <th className="px-2 py-1 text-left">id</th>
              <th className="px-2 py-1 text-left">사례</th>
              <th className="px-2 py-1 text-left">사람 라벨</th>
            </tr>
          </thead>
          <tbody>
            {GOLD_CASES.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="px-2 py-1 font-mono">{c.id}</td>
                <td className="px-2 py-1">{c.title}</td>
                <td className="px-2 py-1">{c.humanLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = "text-fg" }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-2 py-2">
      <p className={`text-lg font-bold ${tone}`}>{value}</p>
      <p className="text-[10px] text-fg-muted">{label}</p>
    </div>
  );
}
