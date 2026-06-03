"use client";

import type { Client, Consultation } from "@/lib/types";
import { formatKRW, formatDurationKo } from "@/lib/format";

interface Props {
  clients: Client[];
  consultations: Consultation[];
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className="card p-4">
      <p className="text-xs text-fg-muted">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold ${
          accent ? "text-gold-500 dark:text-gold-300" : "text-fg"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-fg-muted">{sub}</p>}
    </div>
  );
}

// PB 대시보드: 담당 고객 수 · 총 운용자산(AUM) · 개인/법인 비율 · 평균 상담시간
export default function PBDashboard({ clients, consultations }: Props) {
  const count = clients.length;
  const aum = clients.reduce((s, c) => s + (c.assetSize || 0), 0);
  const individuals = clients.filter((c) => c.clientType === "individual").length;
  const corporates = count - individuals;

  const durations = consultations
    .map((c) => c.durationSeconds)
    .filter((d) => d > 0);
  const avgDuration =
    durations.length > 0
      ? durations.reduce((s, d) => s + d, 0) / durations.length
      : 0;

  const ratio = (n: number) => (count ? Math.round((n / count) * 100) : 0);

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="담당 고객" value={`${count}명`} />
      <Stat label="총 운용자산 (AUM)" value={formatKRW(aum)} accent />
      <Stat
        label="개인 / 법인"
        value={`${individuals} / ${corporates}`}
        sub={`개인 ${ratio(individuals)}% · 법인 ${ratio(corporates)}%`}
      />
      <Stat
        label="평균 상담시간"
        value={avgDuration ? formatDurationKo(avgDuration) : "—"}
        sub={`상담 ${consultations.length}건 기준`}
      />
    </div>
  );
}
