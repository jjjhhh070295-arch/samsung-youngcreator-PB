"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BookAnalysis, ClientBookRow, ClientFlagKind } from "@/lib/advisory/types";
import { CLIENT_FLAG_LABEL, PRODUCT_CATEGORY_LABEL } from "@/lib/advisory/types";
import { formatKRW, formatKRWShort, formatDate } from "@/lib/format";

interface Props {
  pbId: string;
  rows: ClientBookRow[];
  analysis: BookAnalysis | null;
}

type View = "card" | "table";
type FlagFilter = "all" | ClientFlagKind;

function ReturnText({ value }: { value: number | null }) {
  if (value == null) return <span className="text-fg-muted">—</span>;
  const cls = value > 0 ? "text-red-600" : value < 0 ? "text-blue-700" : "text-fg-muted";
  const sign = value > 0 ? "+" : "";
  return <span className={`font-semibold ${cls}`}>{sign}{value.toFixed(1)}%</span>;
}

function FlagChips({ kinds }: { kinds: ClientFlagKind[] }) {
  if (kinds.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {kinds.map((k) => (
        <span key={k} className="rounded-full bg-[#1428A0]/10 px-2 py-0.5 text-[10px] font-semibold text-[#1428A0]">
          {CLIENT_FLAG_LABEL[k]}
        </span>
      ))}
    </div>
  );
}

function MeasuredHint({ asOf, source, currency }: { asOf: string; source: string; currency?: string }) {
  return (
    <p className="text-[10px] text-fg-muted">
      as-of {asOf.slice(0, 10)} · {source}
      {currency ? ` · ${currency}` : ""}
    </p>
  );
}

export default function BookDashboard({ pbId, rows, analysis }: Props) {
  const router = useRouter();
  const [view, setView] = useState<View>("card");
  const [q, setQ] = useState("");
  const [flag, setFlag] = useState<FlagFilter>("all");

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (flag !== "all" && !r.flags.some((f) => f.kind === flag)) return false;
      if (query && !(`${r.name} ${r.code}`.toLowerCase().includes(query))) return false;
      return true;
    });
  }, [rows, q, flag]);

  return (
    <div className="space-y-5">
      {analysis && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="card p-4">
            <p className="text-xs text-fg-muted">북 평가금액</p>
            <p className="mt-1 text-2xl font-bold text-[#1428A0]">{formatKRW(analysis.totalEvalAmount.value)}</p>
            <MeasuredHint asOf={analysis.asOf} source={analysis.source} currency={analysis.currency} />
          </div>
          <div className="card p-4">
            <p className="text-xs text-fg-muted">평균 수익률</p>
            <p className="mt-1 text-2xl font-bold text-fg">
              <ReturnText value={analysis.avgReturnPct?.value ?? null} />
            </p>
            {analysis.avgReturnPct && (
              <MeasuredHint asOf={analysis.avgReturnPct.asOf} source={analysis.avgReturnPct.source} />
            )}
          </div>
          <div className="card p-4">
            <p className="text-xs text-fg-muted">주시 고객</p>
            <p className="mt-1 text-2xl font-bold text-fg">
              {analysis.flagged.highRisk.length + analysis.flagged.lowReturn.length + analysis.flagged.lowLiquidity.length}
              <span className="ml-1 text-sm font-medium text-fg-muted">건</span>
            </p>
            <p className="text-[10px] text-fg-muted">
              위험 {analysis.flagged.highRisk.length} · 저수익 {analysis.flagged.lowReturn.length} · 유동성 {analysis.flagged.lowLiquidity.length}
            </p>
          </div>
          <div className="card p-4">
            <p className="text-xs text-fg-muted">담당 고객</p>
            <p className="mt-1 text-2xl font-bold text-fg">{analysis.clientCount}명</p>
            <p className="text-[10px] text-fg-muted">카드/테이블로 북 관리</p>
          </div>
        </div>
      )}

      {analysis && analysis.productMix.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold text-fg">상품군 편입 비중</h3>
              <MeasuredHint asOf={analysis.asOf} source={analysis.source} currency="KRW" />
            </div>
            <div className="space-y-2">
              {analysis.productMix.map((s) => (
                <div key={s.category}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-medium text-fg">{PRODUCT_CATEGORY_LABEL[s.category]}</span>
                    <span className="text-fg-muted">
                      {s.weightPct.toFixed(1)}% · {s.clientCount}명 · {formatKRWShort(s.amount)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full bg-[#1428A0]" style={{ width: `${Math.min(100, s.weightPct)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-bold text-fg">고객 편입 상품 랭킹</h3>
            <ol className="space-y-2">
              {analysis.productRanking.slice(0, 8).map((p, i) => (
                <li key={`${p.category}-${p.ticker ?? p.name}`} className="flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0">
                    <span className="mr-2 font-mono text-[11px] text-fg-muted">{i + 1}</span>
                    {p.ticker ? (
                      <Link href={`/pb/${pbId}/ticker?symbol=${encodeURIComponent(p.ticker)}`} className="font-medium text-[#1428A0] hover:underline">
                        {p.name}
                      </Link>
                    ) : (
                      <span className="font-medium text-fg">{p.name}</span>
                    )}
                    <span className="ml-2 text-[11px] text-fg-muted">{PRODUCT_CATEGORY_LABEL[p.category]}</span>
                  </div>
                  <span className="shrink-0 text-xs text-fg-muted">{p.clientCount}명 · {formatKRWShort(p.totalAmount)}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}

      {analysis && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {([
            ["high_risk", analysis.flagged.highRisk],
            ["low_return", analysis.flagged.lowReturn],
            ["low_liquidity", analysis.flagged.lowLiquidity],
          ] as const).map(([kind, list]) => (
            <div key={kind} className="card p-4">
              <p className="text-xs font-semibold text-[#1428A0]">{CLIENT_FLAG_LABEL[kind]}</p>
              {list.length === 0 ? (
                <p className="mt-2 text-xs text-fg-muted">해당 없음</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {list.slice(0, 5).map((c) => (
                    <li key={c.clientId}>
                      <Link href={`/pb/${pbId}/${c.clientId}`} className="text-sm font-medium text-fg hover:text-[#1428A0]">
                        {c.name}
                      </Link>
                      <p className="text-[10px] text-fg-muted">{c.flags.find((f) => f.kind === kind)?.reason}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input
          className="input max-w-xs"
          placeholder="이름·코드 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {(["all", "high_risk", "low_return", "low_liquidity"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFlag(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              flag === f ? "bg-[#1428A0] text-white" : "bg-surface-2 text-fg-muted hover:text-fg"
            }`}
          >
            {f === "all" ? "전체" : CLIENT_FLAG_LABEL[f]}
          </button>
        ))}
        <div className="ml-auto flex rounded-lg border border-border overflow-hidden">
          <button className={`px-3 py-1.5 text-xs ${view === "card" ? "bg-[#1428A0] text-white" : "text-fg-muted"}`} onClick={() => setView("card")}>카드</button>
          <button className={`px-3 py-1.5 text-xs ${view === "table" ? "bg-[#1428A0] text-white" : "text-fg-muted"}`} onClick={() => setView("table")}>테이블</button>
        </div>
      </div>

      {view === "card" ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r) => (
            <Link
              key={r.clientId}
              href={`/pb/${pbId}/${r.clientId}`}
              className="card p-4 transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-[10px] text-[#1428A0]">{r.code}</p>
                  <p className="text-base font-bold text-fg">{r.name}</p>
                </div>
                <span className="rounded-md bg-[#0a0a0a] px-2 py-0.5 text-[10px] font-semibold text-white">
                  {r.riskGrade}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-[11px] text-fg-muted">총자산</p>
                  <p className="font-semibold">{formatKRWShort(r.totalAssets)}</p>
                </div>
                <div>
                  <p className="text-[11px] text-fg-muted">총수익률</p>
                  <ReturnText value={r.totalReturnPct} />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1">
                {r.holdings.slice(0, 4).map((h) =>
                  h.ticker ? (
                    <span
                      key={h.name}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        router.push(`/pb/${pbId}/ticker?symbol=${encodeURIComponent(h.ticker!)}`);
                      }}
                      className="rounded-full border border-border px-2 py-0.5 text-[10px] text-fg hover:border-[#1428A0] hover:text-[#1428A0]"
                    >
                      {h.name}
                    </span>
                  ) : (
                    <span key={h.name} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-fg-muted">
                      {h.name}
                    </span>
                  ),
                )}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-[11px] text-fg-muted">
                  {r.lastConsultation
                    ? `${r.lastConsultation.label} · ${formatDate(r.lastConsultation.at)}`
                    : "최근 상담 없음"}
                </p>
                <FlagChips kinds={r.flags.map((f) => f.kind)} />
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-2 text-xs text-fg-muted">
              <tr>
                <th className="px-3 py-2 text-left">고객</th>
                <th className="px-3 py-2 text-right">총자산</th>
                <th className="px-3 py-2 text-right">총수익률</th>
                <th className="px-3 py-2 text-left">위험</th>
                <th className="px-3 py-2 text-left">보유상품</th>
                <th className="px-3 py-2 text-left">최근 상담</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.clientId} className="border-b border-border/60 last:border-0 hover:bg-surface-2">
                  <td className="px-3 py-2">
                    <Link href={`/pb/${pbId}/${r.clientId}`} className="font-semibold text-fg hover:text-[#1428A0]">
                      {r.name}
                    </Link>
                    <p className="font-mono text-[10px] text-fg-muted">{r.code}</p>
                  </td>
                  <td className="px-3 py-2 text-right">{formatKRWShort(r.totalAssets)}</td>
                  <td className="px-3 py-2 text-right"><ReturnText value={r.totalReturnPct} /></td>
                  <td className="px-3 py-2">{r.riskGrade}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {r.holdings.slice(0, 3).map((h) => (
                        <span key={h.name} className="text-[11px] text-fg-muted">{h.name}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-fg-muted">
                    {r.lastConsultation ? `${r.lastConsultation.label} · ${formatDate(r.lastConsultation.at)}` : "—"}
                    <div className="mt-1"><FlagChips kinds={r.flags.map((f) => f.kind)} /></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
