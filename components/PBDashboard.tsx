"use client";

import React from "react";
import type { Client } from "@/lib/types";
import type { AumWeightedReturnResult } from "@/lib/advisory/portfolioReturn";
import { formatKRW } from "@/lib/format";

interface Props {
  clients: Client[];
  investableAum: number;
  aumWeightedReturn: AumWeightedReturnResult;
}

function Stat({
  label,
  value,
  sub,
  valueClassName = "text-fg",
  className = "",
}: {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
  className?: string;
}) {
  return (
    <div className={`relative min-w-0 border-r border-border bg-[#F9FBFF] px-4 py-2.5 last:border-r-0 ${className}`}>
      <span className="absolute left-0 top-1/2 h-6 w-[3px] -translate-y-1/2 rounded-r bg-[#1769D2]" aria-hidden="true" />
      <p className="truncate whitespace-nowrap text-[11px] font-medium text-fg-muted" title={label}>
        {label}
      </p>
      <p className={`mt-0.5 truncate tabular-nums text-[21px] font-black tracking-[-0.02em] ${valueClassName}`}>
        {value}
      </p>
      {sub && <p className="truncate text-[10px] tabular-nums text-fg-muted" title={sub}>{sub}</p>}
    </div>
  );
}

function formatSignedPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  if (Object.is(rounded, -0)) return "0.0%";
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

function formatSignedEok(amountKrw: number): string {
  const rounded = Math.round((amountKrw / 100_000_000) * 10) / 10;
  if (Object.is(rounded, -0)) return "0억원";
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1).replace(/\.0$/, "")}억원`;
}

function aumReturnValueClassName(summary: AumWeightedReturnResult): string {
  if (summary.status !== "ok" || summary.returnPct == null) return "text-fg";
  if (summary.returnPct > 0) return "text-[#0D57BA]";
  if (summary.returnPct < 0) return "text-red-600";
  return "text-fg";
}

// PB 대시보드: 담당 고객 수 · 총 운용자산(AUM) · 개인/법인 비율 · 총 AUM 수익률
export default function PBDashboard({ clients, investableAum, aumWeightedReturn }: Props) {
  const count = clients.length;
  const individuals = clients.filter((c) => c.clientType === "individual").length;
  const corporates = clients.filter((c) => c.clientType === "corporate").length;
  const soleProprietors = clients.filter((c) => c.clientType === "sole_proprietor").length;
  const ratio = (value: number) => count ? Math.round((value / count) * 100) : 0;
  const aumReturnValue =
    aumWeightedReturn.status === "ok" && aumWeightedReturn.returnPct != null
      ? formatSignedPercent(aumWeightedReturn.returnPct)
      : aumWeightedReturn.status === "incomplete"
        ? "산출 불가"
        : "—";
  const aumReturnSub =
    aumWeightedReturn.status === "ok" && aumWeightedReturn.totalPnlKrw != null
      ? `평가손익 ${formatSignedEok(aumWeightedReturn.totalPnlKrw)} · ${formatSignedEok(aumWeightedReturn.totalAumKrw).replace(/^\+/, "")} 기준`
      : aumWeightedReturn.status === "incomplete"
        ? `시세 확인 필요 · AUM 커버리지 ${aumWeightedReturn.coveragePct.toFixed(1)}%`
        : "평가 가능한 운용자산 없음";

  return (
    <div className="grid grid-cols-2 overflow-hidden border border-border bg-[#F9FBFF] lg:grid-cols-4">
      <Stat label="담당 고객" value={`${count}명`} sub={`개인 ${individuals} · 법인 ${corporates} · 개인사업자 ${soleProprietors}`} />
      <Stat label="총 운용자산 (AUM)" value={formatKRW(investableAum)} sub="부동산 제외 투자 가능 자산" valueClassName="text-[#0D57BA]" />
      <Stat label="고객 구성" value={`${individuals} / ${corporates} / ${soleProprietors}`} sub={`개인 ${ratio(individuals)}% · 법인 ${ratio(corporates)}% · 개인사업자 ${ratio(soleProprietors)}%`} />
      <Stat
        label="총 AUM 수익률"
        value={aumReturnValue}
        sub={aumReturnSub}
        valueClassName={aumReturnValueClassName(aumWeightedReturn)}
      />
    </div>
  );
}
