"use client";

import { useCallback, useEffect, useState } from "react";
import type { Household, HouseholdAssets, HouseholdMemberAsset } from "@/lib/types";
import { RELATION_TYPE_LABEL } from "@/lib/types";
import {
  listHouseholds,
  createHousehold,
  updateHousehold,
  deleteHousehold,
  listHouseholdMembers,
  addHouseholdMember,
  removeHouseholdMember,
  computeHouseholdAssets,
  searchParties,
  suggestFamilyMembers,
} from "@/lib/store";
import { formatKRW } from "@/lib/format";

const ROLE_OPTIONS = [
  { value: "head",    label: "가구주" },
  { value: "spouse",  label: "배우자" },
  { value: "child",   label: "자녀" },
  { value: "parent",  label: "부모" },
  { value: "sibling", label: "형제/자매" },
  { value: "other",   label: "기타" },
];

type Member = {
  partyId: string;
  partyName: string;
  partyType: string;
  role: string | null;
  joinedAt: string;
};

type Suggestion = {
  id: string;
  displayName: string;
  partyType: string;
  relatedVia: string;
};

interface MembersPanelProps {
  householdId: string;
  pbId: string;
  onClose: () => void;
}

function MembersPanel({ householdId, pbId, onClose }: MembersPanelProps) {
  const [members, setMembers] = useState<Member[]>([]);
  const [assets, setAssets]   = useState<HouseholdAssets | null>(null);
  const [loadingAssets, setLoadingAssets] = useState(false);

  // 추가 폼
  const [search, setSearch]             = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; displayName: string; partyType: string }[]>([]);
  const [selectedParty, setSelectedParty] = useState<{ id: string; displayName: string } | null>(null);
  const [role, setRole]                 = useState("other");
  const [adding, setAdding]             = useState(false);

  // 관계 추천
  const [suggestions, setSuggestions]   = useState<Suggestion[]>([]);
  const [showSuggest, setShowSuggest]   = useState(false);

  const loadMembers = useCallback(async () => {
    const data = await listHouseholdMembers(householdId);
    setMembers(data);
  }, [householdId]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      const res = await searchParties(search);
      setSearchResults(res.filter((p) => !members.some((m) => m.partyId === p.id)));
    }, 250);
    return () => clearTimeout(t);
  }, [search, members]);

  const handleAdd = async () => {
    if (!selectedParty) return;
    setAdding(true);
    try {
      await addHouseholdMember(householdId, selectedParty.id, role || null);
      setSearch(""); setSearchResults([]); setSelectedParty(null); setRole("other");
      setAssets(null);
      await loadMembers();
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (partyId: string) => {
    await removeHouseholdMember(householdId, partyId);
    setAssets(null);
    await loadMembers();
  };

  const handleLoadAssets = async () => {
    setLoadingAssets(true);
    try {
      const result = await computeHouseholdAssets(householdId);
      setAssets(result);
    } finally {
      setLoadingAssets(false);
    }
  };

  const handleSuggest = async () => {
    setShowSuggest(true);
    const memberIds = members.map((m) => m.partyId);
    const result = await suggestFamilyMembers(memberIds, memberIds);
    setSuggestions(result);
  };

  const handleAddSuggestion = async (s: Suggestion) => {
    const roleMap: Record<string, string> = {
      spouse: "spouse", child: "child", parent: "parent", sibling: "sibling",
    };
    await addHouseholdMember(householdId, s.id, roleMap[s.relatedVia] ?? "other");
    setSuggestions((prev) => prev.filter((x) => x.id !== s.id));
    setAssets(null);
    await loadMembers();
  };

  return (
    <div className="space-y-4">
      {/* 구성원 목록 */}
      <div>
        <p className="text-xs text-fg-muted font-semibold mb-2">구성원 ({members.length}명)</p>
        {members.length === 0 ? (
          <p className="text-xs text-fg-muted">아직 구성원이 없습니다.</p>
        ) : (
          <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
            {members.map((m) => (
              <div key={m.partyId} className="flex items-center justify-between px-3 py-2 bg-surface">
                <div className="flex items-center gap-2">
                  <span className={m.partyType === "corporate" ? "badge-navy" : "badge-muted"}>
                    {m.partyType === "corporate" ? "법인" : "개인"}
                  </span>
                  <span className="text-sm font-medium text-fg">{m.partyName}</span>
                  {m.role && (
                    <span className="text-xs text-fg-muted">
                      ({ROLE_OPTIONS.find((r) => r.value === m.role)?.label ?? m.role})
                    </span>
                  )}
                </div>
                <button
                  className="text-xs text-red-400 hover:text-red-600"
                  onClick={() => handleRemove(m.partyId)}
                >
                  제거
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 구성원 추가 */}
      <div className="rounded-lg border border-border p-3 space-y-2 bg-surface">
        <p className="text-xs font-semibold text-fg-muted">구성원 추가</p>
        {selectedParty ? (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-fg">{selectedParty.displayName}</span>
            <button className="text-xs text-fg-muted hover:text-fg" onClick={() => setSelectedParty(null)}>×</button>
          </div>
        ) : (
          <div className="relative">
            <input
              className="input text-sm w-full"
              placeholder="이름 검색…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {searchResults.length > 0 && (
              <div className="absolute z-10 left-0 right-0 top-full mt-1 bg-surface border border-border rounded shadow-md">
                {searchResults.map((p) => (
                  <button
                    key={p.id}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gold-400/10 flex items-center gap-2"
                    onClick={() => { setSelectedParty({ id: p.id, displayName: p.displayName }); setSearch(""); setSearchResults([]); }}
                  >
                    <span className={p.partyType === "corporate" ? "badge-navy" : "badge-muted"}>
                      {p.partyType === "corporate" ? "법인" : "개인"}
                    </span>
                    {p.displayName}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <select
          className="input text-sm w-full"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          {ROLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <button
            className="btn-primary text-sm"
            disabled={!selectedParty || adding}
            onClick={handleAdd}
          >
            {adding ? "추가 중…" : "추가"}
          </button>
          {members.length > 0 && (
            <button className="btn-outline text-sm" onClick={handleSuggest}>
              관계에서 추천
            </button>
          )}
        </div>
      </div>

      {/* 관계 추천 */}
      {showSuggest && (
        <div className="rounded-lg border border-gold-400/30 p-3 space-y-2 bg-gold-400/5">
          <p className="text-xs font-semibold text-fg-muted">
            가족 관계 연결된 party
            {suggestions.length === 0 && " — 추천 없음 (기존 party_relationships 없거나 이미 모두 추가됨)"}
          </p>
          {suggestions.map((s) => (
            <div key={s.id} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={s.partyType === "corporate" ? "badge-navy" : "badge-muted"}>
                  {s.partyType === "corporate" ? "법인" : "개인"}
                </span>
                <span className="text-sm text-fg">{s.displayName}</span>
                <span className="text-xs text-fg-muted">
                  ({RELATION_TYPE_LABEL[s.relatedVia as keyof typeof RELATION_TYPE_LABEL] ?? s.relatedVia})
                </span>
              </div>
              <button className="btn-outline text-xs" onClick={() => handleAddSuggestion(s)}>
                추가
              </button>
            </div>
          ))}
          <button className="text-xs text-fg-muted hover:text-fg" onClick={() => setShowSuggest(false)}>닫기</button>
        </div>
      )}

      {/* 가문 총자산 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-fg-muted">가문 총자산 (§7-2)</p>
          <button className="btn-outline text-xs" onClick={handleLoadAssets} disabled={loadingAssets}>
            {loadingAssets ? "계산 중…" : assets ? "새로고침" : "계산"}
          </button>
        </div>
        {assets && <HouseholdAssetsView data={assets} />}
      </div>
    </div>
  );
}

function HouseholdAssetsView({ data }: { data: HouseholdAssets }) {
  return (
    <div className="space-y-2">
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gold-400/10 text-fg-muted">
              <th className="px-3 py-2 text-left font-semibold">구성원</th>
              <th className="px-3 py-2 text-right font-semibold">직접 주식</th>
              <th className="px-3 py-2 text-right font-semibold">직접 부동산</th>
              <th className="px-3 py-2 text-right font-semibold">간접(외부법인)</th>
              <th className="px-3 py-2 text-right font-semibold">기여분</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {data.members.map((m) => (
              <tr key={m.partyId} className="bg-surface">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <span className={m.partyType === "corporate" ? "badge-navy" : "badge-muted"}>
                      {m.partyType === "corporate" ? "법인" : "개인"}
                    </span>
                    <span className="font-medium text-fg">{m.partyName}</span>
                    {m.role && <span className="text-fg-muted">({m.role})</span>}
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-fg-muted">{formatKRW(m.directStocks)}</td>
                <td className="px-3 py-2 text-right text-fg-muted">{formatKRW(m.directRealEstate)}</td>
                <td className="px-3 py-2 text-right text-fg-muted">
                  {m.indirectViaExternalCorps > 0 ? formatKRW(m.indirectViaExternalCorps) : "—"}
                </td>
                <td className="px-3 py-2 text-right font-semibold text-fg">{formatKRW(m.contribution)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-gold-400/10 font-bold text-fg border-t border-border">
              <td className="px-3 py-2" colSpan={4}>가문 총자산</td>
              <td className="px-3 py-2 text-right text-[#1428A0]">{formatKRW(data.grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-[11px] text-fg-muted">
        * 가문 구성원인 법인의 자산은 법인 본인 기여분에 계상. 가문 밖 법인만 지분율로 안분 (이중계상 방지)
      </p>
    </div>
  );
}

interface HouseholdModuleProps {
  pbId: string;
}

export default function HouseholdModule({ pbId }: HouseholdModuleProps) {
  const [households, setHouseholds] = useState<Household[]>([]);
  const [loading, setLoading]       = useState(true);
  const [expanded, setExpanded]     = useState<string | null>(null);

  // 생성 폼
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName]       = useState("");
  const [creating, setCreating]     = useState(false);

  // 이름 편집
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editName, setEditName]     = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listHouseholds(pbId);
      setHouseholds(data);
    } finally {
      setLoading(false);
    }
  }, [pbId]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      await createHousehold({ name: newName.trim(), pbId });
      setNewName(""); setShowCreate(false);
      await load();
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("가문을 삭제할까요? 구성원 연결도 모두 해제됩니다.")) return;
    await deleteHousehold(id);
    if (expanded === id) setExpanded(null);
    await load();
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) return;
    await updateHousehold(id, { name: editName.trim() });
    setEditingId(null);
    await load();
  };

  if (loading) {
    return <p className="text-sm text-fg-muted">가문 목록 불러오는 중…</p>;
  }

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-fg-muted">
          가문(Household)을 정의하고 구성원을 등록하면 가문 총자산을 산출합니다.
        </p>
        <button className="btn-outline text-sm" onClick={() => setShowCreate((v) => !v)}>
          + 가문 추가
        </button>
      </div>

      {/* 생성 폼 */}
      {showCreate && (
        <div className="rounded-lg border border-border p-3 space-y-2 bg-surface">
          <p className="text-xs font-semibold text-fg-muted">새 가문</p>
          <input
            className="input text-sm w-full"
            placeholder="가문 이름 (예: 김○○ 가문)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); }}
            autoFocus
          />
          <div className="flex gap-2">
            <button className="btn-primary text-sm" onClick={handleCreate} disabled={creating || !newName.trim()}>
              {creating ? "생성 중…" : "생성"}
            </button>
            <button className="btn-ghost text-sm" onClick={() => setShowCreate(false)}>취소</button>
          </div>
        </div>
      )}

      {/* 가문 목록 */}
      {households.length === 0 ? (
        <p className="text-sm text-fg-muted text-center py-6">아직 등록된 가문이 없습니다.</p>
      ) : (
        <div className="space-y-3">
          {households.map((hh) => (
            <div key={hh.id} className="rounded-lg border border-border overflow-hidden">
              {/* 가문 헤더 */}
              <div className="flex items-center justify-between px-4 py-3 bg-surface">
                {editingId === hh.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <input
                      className="input text-sm flex-1 max-w-xs"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleRename(hh.id); if (e.key === "Escape") setEditingId(null); }}
                      autoFocus
                    />
                    <button className="btn-primary text-xs" onClick={() => handleRename(hh.id)}>저장</button>
                    <button className="btn-ghost text-xs" onClick={() => setEditingId(null)}>취소</button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-fg">{hh.name}</span>
                    <button
                      className="text-xs text-fg-muted hover:text-fg"
                      onClick={() => { setEditingId(hh.id); setEditName(hh.name); }}
                    >
                      이름 수정
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <button
                    className="btn-outline text-xs"
                    onClick={() => setExpanded(expanded === hh.id ? null : hh.id)}
                  >
                    {expanded === hh.id ? "접기 ▲" : "구성원 관리 ▼"}
                  </button>
                  <button
                    className="text-xs text-red-400 hover:text-red-600"
                    onClick={() => handleDelete(hh.id)}
                  >
                    삭제
                  </button>
                </div>
              </div>

              {/* 구성원 + 자산 패널 */}
              {expanded === hh.id && (
                <div className="px-4 py-4 border-t border-border bg-bg">
                  <MembersPanel householdId={hh.id} pbId={pbId} onClose={() => setExpanded(null)} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
