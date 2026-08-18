"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { BookAnalysis, ClientBookRow, ClientFlagKind } from "@/lib/advisory/types";
import { CLIENT_FLAG_LABEL, PRODUCT_CATEGORY_LABEL } from "@/lib/advisory/types";
import { CLIENT_TYPE_LABEL, type ClientType } from "@/lib/types";
import { formatKRW, formatKRWShort, formatDate } from "@/lib/format";

interface Props {
  pbId: string;
  rows: ClientBookRow[];
  analysis: BookAnalysis | null;
}

type View = "table" | "card";
type TypeFilter = "all" | ClientType;
type FlagFilter = "all" | ClientFlagKind;
type SortKey =
  | "name-asc"
  | "name-desc"
  | "return-desc"
  | "return-asc"
  | "assets-desc"
  | "assets-asc"
  | "consult-desc"
  | "consult-asc";

const SORT_OPTIONS: { id: SortKey; label: string }[] = [
  { id: "name-asc", label: "고객명 ㄱㄴㄷ 순" },
  { id: "name-desc", label: "고객명 역순" },
  { id: "return-desc", label: "총수익률 높은 순" },
  { id: "return-asc", label: "총수익률 낮은 순" },
  { id: "assets-desc", label: "유치자산 높은 순" },
  { id: "assets-asc", label: "유치자산 낮은 순" },
  { id: "consult-desc", label: "최근 상담일 최신순" },
  { id: "consult-asc", label: "최근 상담일 오래된 순" },
];

function cmpNullableNumber(a: number | null, b: number | null, dir: 1 | -1) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a === b) return 0;
  return a < b ? -dir : dir;
}

function ReturnText({ value }: { value: number | null }) {
  if (value == null) return <span className="text-fg-muted">—</span>;
  const cls = value > 0 ? "text-red-600" : value < 0 ? "text-blue-700" : "text-fg-muted";
  const sign = value > 0 ? "+" : "";
  return <span className={`font-semibold ${cls}`}>{sign}{value.toFixed(1)}%</span>;
}

function FlagChips({ kinds }: { kinds: ClientFlagKind[] }) {
  if (kinds.length === 0) return <span className="text-[11px] text-fg-muted">—</span>;
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

function headerArrow(active: boolean, desc: boolean) {
  if (!active) return " ↕";
  return desc ? " ▼" : " ▲";
}

function SortTh({
  label,
  align,
  active,
  desc,
  ariaSort,
  onClick,
}: {
  label: string;
  align: "left" | "right";
  active: boolean;
  desc: boolean;
  ariaSort: "ascending" | "descending" | "none";
  onClick: () => void;
}) {
  return (
    <th className={`px-1 py-1 text-xs ${align === "right" ? "text-right" : "text-left"}`} aria-sort={ariaSort}>
      <button
        type="button"
        onClick={onClick}
        className={`w-full whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-semibold hover:bg-white/70 hover:text-[#1428A0] ${
          align === "right" ? "text-right" : "text-left"
        } ${active ? "text-[#1428A0]" : "text-fg"}`}
      >
        {label}
        {headerArrow(active, desc)}
      </button>
    </th>
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
  const [view, setView] = useState<View>("table");
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [flag, setFlag] = useState<FlagFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name-asc");
  const sortLabel = SORT_OPTIONS.find((o) => o.id === sortKey)?.label ?? "고객명 ㄱㄴㄷ 순";

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const matched = rows.filter((r) => {
      if (typeFilter !== "all" && r.clientType !== typeFilter) return false;
      if (flag !== "all" && !r.flags.some((f) => f.kind === flag)) return false;
      if (query && !(r.name.toLowerCase().includes(query) || r.code.toLowerCase().includes(query))) return false;
      return true;
    });
    return matched.slice().sort((a, b) => {
      const byName = a.name.localeCompare(b.name, "ko");
      switch (sortKey) {
        case "name-desc":
          return b.name.localeCompare(a.name, "ko");
        case "return-desc": {
          const c = cmpNullableNumber(a.totalReturnPct, b.totalReturnPct, -1);
          return c || byName;
        }
        case "return-asc": {
          const c = cmpNullableNumber(a.totalReturnPct, b.totalReturnPct, 1);
          return c || byName;
        }
        case "assets-desc": {
          const c = cmpNullableNumber(a.totalAssets, b.totalAssets, -1);
          return c || byName;
        }
        case "assets-asc": {
          const c = cmpNullableNumber(a.totalAssets, b.totalAssets, 1);
          return c || byName;
        }
        case "consult-desc": {
          const aAt = a.lastConsultation?.at || "";
          const bAt = b.lastConsultation?.at || "";
          if (!aAt && !bAt) return byName;
          if (!aAt) return 1;
          if (!bAt) return -1;
          return bAt.localeCompare(aAt) || byName;
        }
        case "consult-asc": {
          const aAt = a.lastConsultation?.at || "";
          const bAt = b.lastConsultation?.at || "";
          if (!aAt && !bAt) return byName;
          if (!aAt) return 1;
          if (!bAt) return -1;
          return aAt.localeCompare(bAt) || byName;
        }
        case "name-asc":
        default:
          return byName;
      }
    });
  }, [rows, q, typeFilter, flag, sortKey]);

  const goClient = (id: string) => router.push(`/pb/${pbId}/${id}`);

  const toggleHeaderSort = (asc: SortKey, desc: SortKey, primary: "asc" | "desc") => {
    setSortKey((cur) => {
      if (cur === asc) return desc;
      if (cur === desc) return asc;
      return primary === "desc" ? desc : asc;
    });
  };

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
            <p className="text-[10px] text-fg-muted">통합 고객 테이블</p>
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

      <div>
        <div className="relative mb-3">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted">🔍</span>
          <input
            className="input pl-9"
            placeholder="이름 또는 식별코드로 검색"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {(["all", "individual", "corporate", "sole_proprietor"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setTypeFilter(f)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  typeFilter === f ? "bg-[#1428A0] text-white" : "bg-surface-2 text-fg-muted hover:text-fg"
                }`}
              >
                {f === "all" ? "전체" : CLIENT_TYPE_LABEL[f]}
              </button>
            ))}
            <span className="mx-1 hidden h-4 w-px bg-border sm:inline" />
            {(["all", "high_risk", "low_return", "low_liquidity"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFlag(f)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  flag === f ? "bg-[#0a0a0a] text-white" : "bg-surface-2 text-fg-muted hover:text-fg"
                }`}
              >
                {f === "all" ? "태그 전체" : CLIENT_FLAG_LABEL[f]}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="flex min-w-0 w-full items-center gap-2 text-xs text-fg-muted sm:max-w-xs">
              <span className="shrink-0 font-semibold text-fg">정렬</span>
              <select
                className="sort-select min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-semibold text-fg"
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                aria-label="고객 테이블 정렬"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center justify-between gap-2 sm:ml-auto sm:justify-end">
              <span className="text-xs text-fg-muted">{filtered.length}명</span>
              <div className="flex overflow-hidden rounded-lg border border-border">
                <button className={`px-3 py-1.5 text-xs ${view === "table" ? "bg-[#1428A0] text-white" : "bg-surface text-fg-muted"}`} onClick={() => setView("table")}>테이블</button>
                <button className={`px-3 py-1.5 text-xs ${view === "card" ? "bg-[#1428A0] text-white" : "bg-surface text-fg-muted"}`} onClick={() => setView("card")}>카드</button>
              </div>
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs font-semibold text-[#1428A0]">
          현재 정렬: {sortLabel}
          <span className="ml-2 font-normal text-fg-muted">· 검색·구분·태그 필터 후 정렬됩니다</span>
        </p>
      </div>

      {filtered.length === 0 ? (
        <div className="card px-3 py-10 text-center text-sm text-fg-muted">
          {q ? `"${q}" 검색 결과가 없어요` : "표시할 고객이 없어요"}
        </div>
      ) : view === "table" ? (
        <div className="card overflow-x-auto">
          <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border bg-surface-2 px-3 py-2">
            <p className="text-xs font-semibold text-[#1428A0]">현재 정렬: {sortLabel}</p>
            <p className="text-[10px] text-fg-muted">헤더를 눌러 같은 기준으로 오름/내림차순을 바꿀 수 있습니다</p>
          </div>
          <table className="w-full min-w-[960px] text-sm">
            <thead className="border-b border-border bg-surface-2 text-xs text-fg-muted">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold">식별코드</th>
                <SortTh
                  label="고객명"
                  align="left"
                  active={sortKey.startsWith("name-")}
                  desc={sortKey === "name-desc"}
                  ariaSort={sortKey === "name-asc" ? "ascending" : sortKey === "name-desc" ? "descending" : "none"}
                  onClick={() => toggleHeaderSort("name-asc", "name-desc", "asc")}
                />
                <th className="px-3 py-2 text-left text-xs font-semibold">구분</th>
                <th className="px-3 py-2 text-left text-xs font-semibold">생년월일/설립일</th>
                <SortTh
                  label="총자산"
                  align="right"
                  active={sortKey.startsWith("assets-")}
                  desc={sortKey === "assets-desc"}
                  ariaSort={sortKey === "assets-asc" ? "ascending" : sortKey === "assets-desc" ? "descending" : "none"}
                  onClick={() => toggleHeaderSort("assets-asc", "assets-desc", "desc")}
                />
                <SortTh
                  label="총수익률"
                  align="right"
                  active={sortKey.startsWith("return-")}
                  desc={sortKey === "return-desc"}
                  ariaSort={sortKey === "return-asc" ? "ascending" : sortKey === "return-desc" ? "descending" : "none"}
                  onClick={() => toggleHeaderSort("return-asc", "return-desc", "desc")}
                />
                <th className="px-3 py-2 text-left text-xs font-semibold">위험성향</th>
                <th className="px-3 py-2 text-left text-xs font-semibold">보유상품</th>
                <SortTh
                  label="최근 상담"
                  align="left"
                  active={sortKey.startsWith("consult-")}
                  desc={sortKey === "consult-desc"}
                  ariaSort={sortKey === "consult-asc" ? "ascending" : sortKey === "consult-desc" ? "descending" : "none"}
                  onClick={() => toggleHeaderSort("consult-asc", "consult-desc", "desc")}
                />
                <th className="px-3 py-2 text-left text-xs font-semibold">태그</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.clientId}
                  onClick={() => goClient(r.clientId)}
                  className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-2"
                >
                  <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-[#1428A0]">{r.code}</td>
                  <td className="px-3 py-2.5 font-semibold text-fg">{r.name}</td>
                  <td className="px-3 py-2.5">
                    <span className="badge-navy">{CLIENT_TYPE_LABEL[r.clientType as ClientType] ?? r.clientType}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">{formatDate(r.birthDate)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium">{formatKRW(r.totalAssets)}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-right"><ReturnText value={r.totalReturnPct} /></td>
                  <td className="whitespace-nowrap px-3 py-2.5">{r.riskGrade}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex max-w-[220px] flex-wrap gap-1">
                      {r.holdings.length === 0 && <span className="text-[11px] text-fg-muted">—</span>}
                      {r.holdings.slice(0, 3).map((h) =>
                        h.ticker ? (
                          <button
                            key={h.name}
                            className="rounded-full border border-border px-2 py-0.5 text-[10px] text-[#1428A0] hover:border-[#1428A0]"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/pb/${pbId}/ticker?symbol=${encodeURIComponent(h.ticker!)}`);
                            }}
                          >
                            {h.name}
                          </button>
                        ) : (
                          <span key={h.name} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-fg-muted">
                            {h.name}
                          </span>
                        ),
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-fg-muted">
                    {r.lastConsultation ? `${r.lastConsultation.label} · ${formatDate(r.lastConsultation.at)}` : "—"}
                  </td>
                  <td className="px-3 py-2.5"><FlagChips kinds={r.flags.map((f) => f.kind)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          <p className="mb-2 text-xs font-semibold text-[#1428A0]">현재 정렬: {sortLabel}</p>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((r) => (
            <button
              key={r.clientId}
              onClick={() => goClient(r.clientId)}
              className="card p-4 text-left transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-mono text-[10px] text-[#1428A0]">{r.code}</p>
                  <p className="text-base font-bold text-fg">{r.name}</p>
                  <p className="text-[11px] text-fg-muted">
                    {CLIENT_TYPE_LABEL[r.clientType as ClientType] ?? r.clientType} · {formatDate(r.birthDate)}
                  </p>
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
                {r.holdings.slice(0, 4).map((h) => (
                  <span key={h.name} className="rounded-full border border-border px-2 py-0.5 text-[10px] text-fg">
                    {h.name}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-[11px] text-fg-muted">
                  {r.lastConsultation
                    ? `${r.lastConsultation.label} · ${formatDate(r.lastConsultation.at)}`
                    : "최근 상담 없음"}
                </p>
                <FlagChips kinds={r.flags.map((f) => f.kind)} />
              </div>
            </button>
          ))}
        </div>
        </div>
      )}
    </div>
  );
}
