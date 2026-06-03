"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Client, ClientType, PB } from "@/lib/types";
import { formatKRW, formatDate } from "@/lib/format";

type SortKey = "code" | "name" | "clientType" | "birthDate" | "pb" | "assetSize";
type SortDir = "asc" | "desc";

interface Props {
  clients: Client[];
  pbs: PB[];
  // 행 클릭 시 이동할 경로 생성기 (PB 화면/고객 화면 등)
  rowHref?: (c: Client) => string;
  showPbColumn?: boolean;
  searchable?: boolean; // 이름/식별코드 검색창 표시
  onEdit?: (c: Client) => void;
  onDelete?: (c: Client) => void;
}

const TYPE_LABEL: Record<ClientType, string> = {
  individual: "개인",
  corporate: "법인",
};

export default function ClientTable({
  clients,
  pbs,
  rowHref,
  showPbColumn = true,
  searchable = false,
  onEdit,
  onDelete,
}: Props) {
  const router = useRouter();
  const [sortKey, setSortKey] = useState<SortKey>("code");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [filter, setFilter] = useState<"all" | ClientType>("all");
  const [query, setQuery] = useState("");

  const pbName = (id: string) => pbs.find((p) => p.id === id)?.name ?? "미지정";

  const sorted = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = clients.filter((c) => {
      if (filter !== "all" && c.clientType !== filter) return false;
      if (q && !(c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)))
        return false;
      return true;
    });
    const dir = sortDir === "asc" ? 1 : -1;
    return filtered.slice().sort((a, b) => {
      switch (sortKey) {
        case "assetSize":
          return (a.assetSize - b.assetSize) * dir;
        case "birthDate":
          return a.birthDate.localeCompare(b.birthDate) * dir;
        case "clientType":
          return a.clientType.localeCompare(b.clientType) * dir;
        case "pb":
          return pbName(a.assignedPbId).localeCompare(pbName(b.assignedPbId), "ko") * dir;
        case "name":
          return a.name.localeCompare(b.name, "ko") * dir;
        case "code":
        default:
          return a.code.localeCompare(b.code) * dir;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, filter, query, sortKey, sortDir, pbs]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const headerBtn =
    "px-3 py-2 text-left text-xs font-semibold text-fg-muted hover:text-fg cursor-pointer select-none whitespace-nowrap";

  const go = (c: Client) => {
    if (rowHref) router.push(rowHref(c));
  };

  return (
    <div>
      {/* 검색 */}
      {searchable && (
        <div className="relative mb-3">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted">
            🔍
          </span>
          <input
            className="input pl-9"
            value={query}
            placeholder="이름 또는 식별코드로 검색"
            onChange={(e) => setQuery(e.target.value)}
          />
          {query && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted hover:text-fg"
              onClick={() => setQuery("")}
              aria-label="검색어 지우기"
            >
              ✕
            </button>
          )}
        </div>
      )}

      {/* 필터 */}
      <div className="mb-3 flex items-center gap-2">
        {(["all", "individual", "corporate"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === f
                ? "bg-gold-500 text-navy-900"
                : "bg-surface-2 text-fg-muted hover:text-fg"
            }`}
          >
            {f === "all" ? "전체" : TYPE_LABEL[f]}
          </button>
        ))}
        <span className="ml-auto text-xs text-fg-muted">{sorted.length}명</span>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-2">
            <tr>
              <th className={headerBtn} onClick={() => toggleSort("code")}>
                식별코드{arrow("code")}
              </th>
              <th className={headerBtn} onClick={() => toggleSort("name")}>
                이름{arrow("name")}
              </th>
              <th className={headerBtn} onClick={() => toggleSort("clientType")}>
                구분{arrow("clientType")}
              </th>
              <th className={headerBtn} onClick={() => toggleSort("birthDate")}>
                생년월일(설립일){arrow("birthDate")}
              </th>
              {showPbColumn && (
                <th className={headerBtn} onClick={() => toggleSort("pb")}>
                  담당 PB{arrow("pb")}
                </th>
              )}
              <th
                className={headerBtn + " text-right"}
                onClick={() => toggleSort("assetSize")}
              >
                자산규모{arrow("assetSize")}
              </th>
              {(rowHref || onEdit || onDelete) && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-8 text-center text-sm text-fg-muted"
                >
                  {query ? `"${query}" 검색 결과가 없어요` : "표시할 고객이 없어요"}
                </td>
              </tr>
            )}
            {sorted.map((c) => (
              <tr
                key={c.id}
                onClick={() => go(c)}
                className={`border-b border-border/60 transition-colors last:border-0 ${
                  rowHref ? "cursor-pointer hover:bg-surface-2" : ""
                }`}
              >
                <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-gold-600 dark:text-gold-300">
                  {c.code}
                </td>
                <td className="px-3 py-2.5 font-medium text-fg">{c.name}</td>
                <td className="px-3 py-2.5">
                  <span className={c.clientType === "corporate" ? "badge-navy" : "badge-muted"}>
                    {TYPE_LABEL[c.clientType]}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-fg-muted">
                  {formatDate(c.birthDate)}
                </td>
                {showPbColumn && (
                  <td className="px-3 py-2.5 text-fg-muted">{pbName(c.assignedPbId)}</td>
                )}
                <td className="whitespace-nowrap px-3 py-2.5 text-right font-medium text-fg">
                  {formatKRW(c.assetSize)}
                </td>
                {(rowHref || onEdit || onDelete) && (
                  <td className="whitespace-nowrap px-3 py-2.5 text-right">
                    <div className="flex justify-end gap-1">
                      {rowHref && (
                        <button
                          className="btn-gold h-7 px-2.5 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            go(c);
                          }}
                        >
                          상담·7요인 →
                        </button>
                      )}
                      {onEdit && (
                        <button
                          className="btn-ghost h-7 px-2 text-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            onEdit(c);
                          }}
                        >
                          수정
                        </button>
                      )}
                      {onDelete && (
                        <button
                          className="btn-ghost h-7 px-2 text-xs text-red-500"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDelete(c);
                          }}
                        >
                          삭제
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
