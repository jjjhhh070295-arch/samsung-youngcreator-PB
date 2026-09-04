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
    <div className={`rounded-xl border border-border bg-white p-3.5 ${className}`}>
      {/* 라벨은 절대 줄바꿈하지 않는다. 폭이 모자라면 말줄임 + title 로 전문을 보여준다. */}
      <p className="truncate whitespace-nowrap text-xs text-fg-muted" title={label}>
        {label}
      </p>
      <p
        className={`mt-1 text-xl font-black tracking-tight ${
          accent ? "text-[#1428A0]" : "text-fg"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-fg-muted">{sub}</p>}
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

  const ratio = (n: number) => (count ? Math.round((n / count) * 100) : 0);

  return (
    <div className="grid grid-cols-2 gap-2 xl:grid-cols-1 2xl:grid-cols-2">
      <Stat label="담당 고객" value={`${count}명`} />
      <Stat label="총 운용자산 (AUM)" value={formatKRW(investableAum)} accent />
      {/* 라벨·설명이 네 카드 중 가장 길다. 2열로 깔리는 폭(기본·2xl)에서는 한 칸이
          좁아 라벨이 깨지므로 그 구간에서만 두 칸을 쓴다. xl 은 원래 1열이라 그대로. */}
      <Stat
        className="col-span-2 xl:col-span-1 2xl:col-span-2"
        label="개인 / 법인 / 개인사업자"
        value={`${individuals} / ${corporates} / ${soleProprietors}`}
        sub={`개인 ${ratio(individuals)}% · 법인 ${ratio(corporates)}% · 개인사업자 ${ratio(soleProprietors)}%`}
      />
      <Stat
        label="평균 상담시간"
        value={avgDuration ? formatDurationKo(avgDuration) : "—"}
        sub={`상담 ${consultations.length}건 기준`}
      />
    </div>
  );
}
