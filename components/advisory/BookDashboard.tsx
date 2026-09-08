"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClientBookRow } from "@/lib/advisory/types";
import { CLIENT_TYPE_LABEL, type ClientType } from "@/lib/types";
import { formatKRWShort, formatDate } from "@/lib/format";
import ClientAvatar from "@/components/ClientAvatar";

interface Props {
  pbId: string;
  rows: ClientBookRow[];
}

type View = "table" | "card";
type TypeFilter = "all" | ClientType;
type LossTagFilter = "all" | "손실중" | "관리필요";
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

const LEGACY_TAG_FILTERS = new Set([
  "high_risk",
  "low_return",
  "low_liquidity",
  "heritage",
  "위험고객",
  "수익률 저조",
  "유동성 부족",
  "신탁·상속 상담 필요",
]);

function cmpNullableNumber(a: number | null, b: number | null, dir: 1 | -1) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (a === b) return 0;
  return a < b ? -dir : dir;
}

function ReturnText({
  value,
  status,
  note,
}: {
  value: number | null;
  status?: ClientBookRow["returnStatus"];
  note?: string | null;
}) {
  if (status === "incomplete" || status === "unavailable" || value == null) {
    return (
      <span className="text-fg-muted" title={note || undefined}>
        —
        {note ? (
          <span className="ml-1 text-[10px] font-normal">
            ({status === "incomplete" ? "시세미확정" : "산출불가"})
          </span>
        ) : null}
      </span>
    );
  }
  const cls = value > 0 ? "text-red-600" : value < 0 ? "text-blue-700" : "text-fg-muted";
  const sign = value > 0 ? "+" : "";
  return (
    <span className={`font-semibold ${cls}`}>
      {sign}
      {value.toFixed(1)}%
    </span>
  );
}

function LossTagBadge({ tag }: { tag: ClientBookRow["bookLossTag"] }) {
  if (!tag) return <span className="text-[11px] text-fg-muted">—</span>;
  if (tag === "관리필요") {
    return (
      <span className="rounded-md bg-red-600 px-2 py-0.5 text-[10px] font-bold text-white">
        관리필요
      </span>
    );
  }
  return (
    <span className="rounded-md bg-amber-300 px-2 py-0.5 text-[10px] font-bold text-amber-950">
      손실중
    </span>
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
  thClassName = "",
}: {
  label: string;
  align: "left" | "right";
  active: boolean;
  desc: boolean;
  ariaSort: "ascending" | "descending" | "none";
  onClick: () => void;
  thClassName?: string;
}) {
  return (
    <th
      className={`px-1 py-1 text-xs ${align === "right" ? "text-right" : "text-left"} ${thClassName}`}
      aria-sort={ariaSort}
    >
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

export default function BookDashboard({ pbId, rows }: Props) {
  const router = useRouter();
  const [view, setView] = useState<View>("table");
  const [q, setQ] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [flag, setFlag] = useState<LossTagFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name-asc");
  const sortLabel = SORT_OPTIONS.find((o) => o.id === sortKey)?.label ?? "고객명 ㄱㄴㄷ 순";

  useEffect(() => {
    if (typeof flag === "string" && LEGACY_TAG_FILTERS.has(flag)) {
      setFlag("all");
    }
  }, [flag]);

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();
    const matched = rows.filter((r) => {
      if (typeFilter !== "all" && r.clientType !== typeFilter) return false;
      if (flag === "손실중" && r.bookLossTag !== "손실중") return false;
      if (flag === "관리필요" && r.bookLossTag !== "관리필요") return false;
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
    <section id="customer-book" className="relative overflow-hidden border border-border bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5 lg:px-4">
        <div className="mr-auto flex items-baseline gap-2">
          <h2 className="text-base font-black text-[#0D57BA]">고객 Book</h2>
          <span className="text-[11px] font-medium text-fg-muted">{filtered.length} Clients</span>
        </div>
        <div className="grid w-full gap-2 lg:w-auto lg:grid-cols-[minmax(280px,304px)_auto] lg:items-center">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-fg-muted" aria-hidden="true">
              ⌕
            </span>
            <input
              className="h-8 w-full rounded border border-[#BAC7D8] bg-white pl-8 pr-3 text-xs outline-none placeholder:text-slate-400 focus:border-[#1769D2] focus:ring-2 focus:ring-[#1769D2]/15"
              placeholder="이름 또는 식별코드로 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1">
              {(["all", "individual", "corporate", "sole_proprietor"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setTypeFilter(f)}
                  className={`pb-control ${typeFilter === f ? "pb-control-active" : ""}`}
                >
                  {f === "all" ? "전체" : CLIENT_TYPE_LABEL[f]}
                </button>
              ))}
              <span className="mx-1 hidden h-5 w-px bg-border sm:inline" />
              {(
                [
                  { id: "all" as const, label: "태그 전체" },
                  { id: "손실중" as const, label: "손실중" },
                  { id: "관리필요" as const, label: "관리필요" },
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFlag(f.id)}
                  className={`pb-control ${flag === f.id ? "pb-control-active" : ""}`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="flex min-w-0 w-full items-center gap-2 text-xs text-fg-muted sm:max-w-xs">
                <span className="shrink-0 font-semibold text-fg">정렬</span>
                <select
                  className="sort-select h-8 min-w-0 flex-1 rounded border border-border bg-surface px-2 text-xs font-semibold text-fg"
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
                <div className="flex h-8 overflow-hidden rounded border border-border">
                  <button
                    className={`px-3 text-xs ${view === "table" ? "bg-[#1769D2] font-semibold text-white" : "bg-surface text-fg-muted"}`}
                    onClick={() => setView("table")}
                  >
                    표
                  </button>
                  <button
                    className={`px-3 text-xs ${view === "card" ? "bg-[#1769D2] font-semibold text-white" : "bg-surface text-fg-muted"}`}
                    onClick={() => setView("card")}
                  >
                    카드
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card px-3 py-8 text-center text-sm text-fg-muted">
          <p className="font-bold text-slate-700">
            {q ? `"${q}" 조건에 맞는 고객이 없습니다.` : "조건에 맞는 고객이 없습니다."}
          </p>
          <p className="mt-1 text-xs">필터를 변경하거나 고객을 추가해보세요.</p>
        </div>
      ) : view === "table" ? (
        <div className="overflow-x-auto border-t border-border">
          <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border bg-[#F2F6FC] px-3 py-1.5">
            <p className="text-xs font-semibold text-[#1428A0]">현재 정렬: {sortLabel}</p>
          </div>
          <table className="w-full min-w-[1180px] text-[13px]">
            <thead className="border-b border-border bg-[#F2F6FC] text-[11px] text-[#52647C]">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-semibold">식별코드</th>
                <SortTh
                  label="고객명"
                  align="left"
                  thClassName="min-w-[10rem]"
                  active={sortKey.startsWith("name-")}
                  desc={sortKey === "name-desc"}
                  ariaSort={
                    sortKey === "name-asc" ? "ascending" : sortKey === "name-desc" ? "descending" : "none"
                  }
                  onClick={() => toggleHeaderSort("name-asc", "name-desc", "asc")}
                />
                <th className="px-3 py-2 text-left text-xs font-semibold">구분</th>
                <th className="px-3 py-2 text-left text-xs font-semibold">생년월일/설립일</th>
                <SortTh
                  label="총자산"
                  align="right"
                  active={sortKey.startsWith("assets-")}
                  desc={sortKey === "assets-desc"}
                  ariaSort={
                    sortKey === "assets-asc"
                      ? "ascending"
                      : sortKey === "assets-desc"
                        ? "descending"
                        : "none"
                  }
                  onClick={() => toggleHeaderSort("assets-asc", "assets-desc", "desc")}
                />
                <SortTh
                  label="총수익률"
                  align="right"
                  active={sortKey.startsWith("return-")}
                  desc={sortKey === "return-desc"}
                  ariaSort={
                    sortKey === "return-asc"
                      ? "ascending"
                      : sortKey === "return-desc"
                        ? "descending"
                        : "none"
                  }
                  onClick={() => toggleHeaderSort("return-asc", "return-desc", "desc")}
                />
                <th className="px-3 py-2 text-left text-xs font-semibold">위험성향</th>
                <th className="px-3 py-2 text-left text-xs font-semibold">보유상품</th>
                <SortTh
                  label="최근 상담"
                  align="left"
                  active={sortKey.startsWith("consult-")}
                  desc={sortKey === "consult-desc"}
                  ariaSort={
                    sortKey === "consult-asc"
                      ? "ascending"
                      : sortKey === "consult-desc"
                        ? "descending"
                        : "none"
                  }
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
                  <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-[#1428A0]">{r.code}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <ClientAvatar name={r.name} type={r.clientType as ClientType} size="sm" />
                      <span className="font-bold text-fg">{r.name}</span>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-fg-muted">
                    {CLIENT_TYPE_LABEL[r.clientType as ClientType] ?? r.clientType}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs text-fg-muted">{formatDate(r.birthDate)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right font-semibold">
                    {formatKRWShort(r.totalAssets)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <ReturnText value={r.totalReturnPct} status={r.returnStatus} note={r.returnNote} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{r.riskGrade}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {r.holdings.length === 0 ? (
                        <span className="text-[11px] text-fg-muted">—</span>
                      ) : (
                        r.holdings.map((h) =>
                          h.ticker ? (
                            <button
                              key={h.name}
                              type="button"
                              className="rounded-full border border-border px-2 py-0.5 text-[10px] text-[#1428A0] hover:bg-[#1428A0]/5"
                              onClick={(e) => {
                                e.stopPropagation();
                                router.push(`/pb/${pbId}/ticker?symbol=${encodeURIComponent(h.ticker!)}`);
                              }}
                            >
                              {h.name}
                            </button>
                          ) : (
                            <span
                              key={h.name}
                              className="rounded-full border border-border px-2 py-0.5 text-[10px] text-fg-muted"
                            >
                              {h.name}
                            </span>
                          ),
                        )
                      )}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-xs text-fg-muted">
                    {r.lastConsultation
                      ? `${r.lastConsultation.label} · ${formatDate(r.lastConsultation.at)}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    <LossTagBadge tag={r.bookLossTag} />
                  </td>
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
                    <ReturnText value={r.totalReturnPct} status={r.returnStatus} note={r.returnNote} />
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
                  <LossTagBadge tag={r.bookLossTag} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
