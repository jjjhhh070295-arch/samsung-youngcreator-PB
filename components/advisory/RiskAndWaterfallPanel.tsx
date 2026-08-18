"use client";

import type { CalcResults, MeasuredNumber } from "@/lib/advisory/types";
import { formatKRW } from "@/lib/format";
import MeasuredMeta from "./MeasuredMeta";

export default function RiskAndWaterfallPanel({ results }: { results: CalcResults }) {
  const { risk, stress, waterfall } = results;
  return (
    <div className="space-y-4">
      <div className="card p-4">
        <h3 className="text-sm font-bold text-fg">결정론 리스크 지표</h3>
        <p className="mt-1 text-[11px] text-fg-muted">AI가 산출한 값이 아닙니다. VaR/CVaR는 과거 가정 기반 파라메트릭 근사입니다.</p>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
          <Metric label="기대수익" n={risk.expectedReturn} />
          <Metric label="변동성" n={risk.volatility} />
          <Metric label="Sharpe" n={risk.sharpe} />
          <Metric label="MDD" n={risk.mdd} />
          <Metric label="VaR 95%" n={risk.var95} />
          <Metric label="CVaR 95%" n={risk.cvar95} />
        </div>
      </div>
      <div className="card p-4">
        <h3 className="text-sm font-bold text-fg">스트레스 시나리오</h3>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          {stress.map((s) => (
            <div key={s.id} className="rounded-lg border border-border p-3">
              <p className="text-sm font-semibold text-fg">{s.label}</p>
              <p className="mt-1 text-lg font-bold text-[#1428A0]">
                {s.shockPct.value}% · {formatKRW(s.pnlWon.value)}
              </p>
              <MeasuredMeta n={s.pnlWon} />
              <p className="mt-1 text-[11px] text-fg-muted">{s.assumption}</p>
            </div>
          ))}
        </div>
      </div>
      {waterfall && (
        <div className="card p-4">
          <h3 className="text-sm font-bold text-fg">세후 결과 워터폴</h3>
          <table className="mt-2 w-full text-sm">
            <tbody>
              <Row label="세전 기말자산" n={waterfall.pretaxEnding} />
              <Row label="예상 세금" n={waterfall.expectedTax} negative />
              <Row label="상품/거래 비용" n={waterfall.productCost} negative />
              <Row label="세후 기말자산" n={waterfall.afterTaxEnding} strong />
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Metric({ label, n }: { label: string; n: MeasuredNumber }) {
  return (
    <div>
      <p className="text-[11px] text-fg-muted">{label}</p>
      <p className="text-lg font-bold text-fg">
        {n.value}
        {n.unit === "ratio" ? "" : n.unit}
      </p>
      <MeasuredMeta n={n} />
    </div>
  );
}

function Row({
  label,
  n,
  negative,
  strong,
}: {
  label: string;
  n: MeasuredNumber;
  negative?: boolean;
  strong?: boolean;
}) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className={`py-2 ${strong ? "font-bold" : ""}`}>{label}</td>
      <td className={`py-2 text-right ${strong ? "font-bold text-[#1428A0]" : ""}`}>
        {negative ? "−" : ""}
        {formatKRW(n.value)}
        <MeasuredMeta n={n} />
      </td>
    </tr>
  );
}
