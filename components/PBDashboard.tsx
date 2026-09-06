"use client";

import type { Client, Consultation } from "@/lib/types";
import { formatKRW, formatDurationKo } from "@/lib/format";

interface Props {
  clients: Client[];
  consultations: Consultation[];
  investableAum: number;
}

function Stat({
  label,
  value,
  sub,
  accent,
  className = "",
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  className?: string;
}) {
  return (
    <div className={`relative min-w-0 border-r border-border bg-[#F9FBFF] px-4 py-2.5 last:border-r-0 ${className}`}>
      <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r bg-[#1769D2]" aria-hidden="true" />
      {/* 라벨은 절대 줄바꿈하지 않는다. 폭이 모자라면 말줄임 + title 로 전문을 보여준다. */}
      <p className="truncate whitespace-nowrap text-[11px] font-medium text-fg-muted" title={label}>
        {label}
      </p>
      <p
        className={`mt-0.5 text-[21px] font-black tracking-[-0.02em] ${
          accent ? "text-[#0D57BA]" : "text-fg"
        }`}
      >
        {value}
      </p>
      {sub && <p className="truncate text-[10px] text-fg-muted" title={sub}>{sub}</p>}
    </div>
  );
}

// PB 대시보드: 담당 고객 수 · 총 운용자산(AUM) · 개인/법인 비율 · 평균 상담시간
export default function PBDashboard({ clients, consultations, investableAum }: Props) {
  const count = clients.length;
  const individuals = clients.filter((c) => c.clientType === "individual").length;
  const corporates = clients.filter((c) => c.clientType === "corporate").length;
  const soleProprietors = clients.filter((c) => c.clientType === "sole_proprietor").length;

  const durations = consultations
    .map((c) => c.durationSeconds)
    .filter((d) => d > 0);
  const avgDuration =
    durations.length > 0
      ? durations.reduce((s, d) => s + d, 0) / durations.length
      : 0;

  const ratio = (value: number) => count ? Math.round((value / count) * 100) : 0;

  return (
    <div className="grid grid-cols-2 overflow-hidden border border-border bg-[#F9FBFF] lg:grid-cols-4">
      <Stat label="담당 고객" value={`${count}명`} sub={`개인 ${individuals} · 법인 ${corporates} · 개인사업자 ${soleProprietors}`} />
      <Stat label="총 운용자산 (AUM)" value={formatKRW(investableAum)} sub="부동산 제외 투자 가능 자산" accent />
      <Stat label="고객 구성" value={`${individuals} / ${corporates} / ${soleProprietors}`} sub={`개인 ${ratio(individuals)}% · 법인 ${ratio(corporates)}% · 개인사업자 ${ratio(soleProprietors)}%`} />
      <Stat
        label="평균 상담시간"
        value={avgDuration ? formatDurationKo(avgDuration) : "—"}
        sub={`상담 ${consultations.length}건 기준`}
      />
    </div>
  );
}
