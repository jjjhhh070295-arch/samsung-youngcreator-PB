"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PartyRelationship, RelationType, EffectiveAssets } from "@/lib/types";
import { RELATION_TYPE_LABEL } from "@/lib/types";
import {
  listRelationships,
  createRelationship,
  closeRelationship,
  searchParties,
  computeEffectiveAssets,
} from "@/lib/store";

interface Props {
  partyId: string;
  partyType: "individual" | "corporate";
}

// 화면 표시용 레이블 — 현재 고객 기준 관계
const VIEW_OPTIONS: { value: string; label: string; direction: "from" | "to" | "from-family" }[] = [
  { value: "owns",    label: "소유 법인",    direction: "from" },
  { value: "child",   label: "자녀 (내가 부모)", direction: "from" },
  { value: "child_as_child", label: "부모 (내가 자녀)", direction: "to" },
  { value: "spouse",  label: "배우자",       direction: "from-family" },
  { value: "sibling", label: "형제/자매",    direction: "from-family" },
  { value: "heir",    label: "상속인",       direction: "from" },
];

function formatW(n: number) {
  if (n === 0) return "—";
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + "억";
  if (n >= 10_000) return (n / 10_000).toFixed(0) + "만";
  return n.toLocaleString("ko-KR");
}

function RelBadge({ type }: { type: RelationType }) {
  const colors: Record<RelationType, string> = {
    owns:    "bg-[#1428A0]/10 text-[#1428A0]",
    child:   "bg-green-50 text-green-700",
    parent:  "bg-green-50 text-green-700",
    spouse:  "bg-pink-50 text-pink-700",
    sibling: "bg-purple-50 text-purple-700",
    heir:    "bg-amber-50 text-amber-700",
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border border-current/20 ${colors[type]}`}>
      {RELATION_TYPE_LABEL[type]}
    </span>
  );
}

export default function PartyRelationshipModule({ partyId, partyType }: Props) {
  const [tab, setTab] = useState<"list" | "add">("list");
  const [rels, setRels] = useState<PartyRelationship[]>([]);
  const [allRels, setAllRels] = useState<PartyRelationship[]>([]);
  const [partyNames, setPartyNames] = useState<Record<string, string>>({});
  const [effective, setEffective] = useState<EffectiveAssets | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  // 추가 폼
  const [viewOption, setViewOption] = useState(VIEW_OPTIONS[0].value);
  const [targetQuery, setTargetQuery] = useState("");
  const [targetResults, setTargetResults] = useState<{ id: string; displayName: string; partyType: string }[]>([]);
  const [targetDropdown, setTargetDropdown] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState<{ id: string; displayName: string } | null>(null);
  const [ownershipPct, setOwnershipPct] = useState("");
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [active, all] = await Promise.all([
        listRelationships(partyId, true),
        listRelationships(partyId, false),
      ]);
      setRels(active);
      setAllRels(all);

      // 상대방 이름 조회
      const idSet: Record<string, true> = {};
      all.flatMap((r) => [r.fromPartyId, r.toPartyId]).forEach((id) => { if (id !== partyId) idSet[id] = true; });
      const ids = Object.keys(idSet);
      if (ids.length > 0) {
        const { supabase: sb } = await import("@/lib/supabase");
        if (sb) {
          const { data } = await sb.from("parties").select("id, display_name").in("id", ids);
          const map: Record<string, string> = {};
          (data ?? []).forEach((r: any) => { map[r.id] = r.display_name; });
          setPartyNames(map);
        }
      }

      // 실질 지배자산 — owns 관계 있을 때만 계산 (partyType 무관하게 관계 기반)
      const hasOwns = active.some((r) => r.relationType === "owns" && r.fromPartyId === partyId);
      if (hasOwns) {
        try {
          const ea = await computeEffectiveAssets(partyId);
          setEffective(ea);
        } catch {
          // 실질자산 계산 실패해도 관계 목록은 보여줌
        }
      }
    } catch (e: any) {
      console.error("PartyRelationshipModule load error:", e);
      setLoadError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [partyId, partyType]);

  useEffect(() => { load(); }, [load]);

  // 상대방 검색 디바운스
  useEffect(() => {
    if (!targetQuery.trim()) { setTargetResults([]); return; }
    const t = setTimeout(async () => {
      const res = await searchParties(targetQuery, partyId);
      setTargetResults(res);
      setTargetDropdown(true);
    }, 250);
    return () => clearTimeout(t);
  }, [targetQuery, partyId]);

  const handleClose = async (id: string) => {
    setClosing(id);
    await closeRelationship(id);
    await load();
    setClosing(null);
  };

  const handleAdd = async () => {
    if (!selectedTarget) { setMsg({ ok: false, text: "상대방을 검색해서 선택하세요." }); return; }
    const opt = VIEW_OPTIONS.find((o) => o.value === viewOption)!;
    const relType: RelationType = viewOption === "child_as_child" ? "child" : (viewOption as RelationType);

    let fromId: string;
    let toId: string;
    if (opt.direction === "to") {
      // "내가 자녀" → from=상대방(부모), to=나
      fromId = selectedTarget.id;
      toId = partyId;
    } else {
      fromId = partyId;
      toId = selectedTarget.id;
    }

    if (relType === "owns" && !ownershipPct) {
      setMsg({ ok: false, text: "지분율을 입력하세요." });
      return;
    }

    setSaving(true);
    setMsg(null);
    try {
      await createRelationship({
        fromPartyId: fromId,
        toPartyId: toId,
        relationType: relType,
        ownershipPct: relType === "owns" ? Number(ownershipPct) : null,
        validFrom,
      });
      setMsg({ ok: true, text: "관계가 등록되었습니다." });
      setSelectedTarget(null);
      setTargetQuery("");
      setOwnershipPct("");
      setValidFrom(new Date().toISOString().slice(0, 10));
      await load();
      setTimeout(() => { setMsg(null); setTab("list"); }, 800);
    } catch (e: any) {
      setMsg({ ok: false, text: `저장 실패: ${e.message}` });
    }
    setSaving(false);
  };

  const getRelLabel = (rel: PartyRelationship): string => {
    const otherId = rel.fromPartyId === partyId ? rel.toPartyId : rel.fromPartyId;
    const otherName = partyNames[otherId] ?? otherId.slice(0, 8) + "…";
    if (rel.relationType === "owns" && rel.fromPartyId === partyId) {
      return `${otherName} (${rel.ownershipPct ?? "?"}% 소유)`;
    }
    if (rel.relationType === "child") {
      return rel.fromPartyId === partyId ? `자녀: ${otherName}` : `부모: ${otherName}`;
    }
    return otherName;
  };

  const tabBar = (
    <div className="flex gap-1 mb-4 border-b border-border">
      {([["list", `등록된 관계${rels.length > 0 ? ` (${rels.length})` : ""}`], ["add", "관계 추가"]] as const).map(([t, label]) => (
        <button key={t} onClick={() => setTab(t)}
          className={`px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${tab === t ? "border-[#1428A0] text-[#1428A0]" : "border-transparent text-fg-muted hover:text-fg"}`}>
          {label}
        </button>
      ))}
    </div>
  );

  // ── 목록 탭 ──
  if (tab === "list") {
    const displayed = showHistory ? allRels : rels;
    const hasOwns = rels.some((r) => r.relationType === "owns" && r.fromPartyId === partyId);

    return (
      <div>
        {tabBar}
        {loading ? (
          <p className="py-6 text-center text-sm text-fg-muted">불러오는 중…</p>
        ) : loadError ? (
          <div className="py-6 text-center space-y-2">
            <p className="text-sm text-red-500">{loadError}</p>
            <button className="btn-outline text-xs" onClick={load}>다시 시도</button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* 실질 지배자산 (owns 관계 있을 때) */}
            {effective && (effective.directTotal > 0 || effective.indirectTotal > 0) && (
              <div className="rounded-xl border border-[#1428A0]/20 bg-[#1428A0]/5 px-5 py-4">
                <p className="text-xs font-semibold text-[#1428A0] mb-3 uppercase tracking-wide">실질 지배자산 (§7-1)</p>
                <div className="grid grid-cols-3 gap-3 text-center mb-3">
                  {[
                    ["직접 보유 주식", formatW(effective.directStocks), "text-fg"],
                    ["직접 보유 부동산", formatW(effective.directRealEstate), "text-fg"],
                    ["직접 소계", formatW(effective.directTotal), "text-fg font-bold"],
                  ].map(([l, v, cls]) => (
                    <div key={l as string} className="rounded-lg bg-white px-2 py-2">
                      <p className="text-[9px] text-fg-muted mb-0.5">{l as string}</p>
                      <p className={`text-sm ${cls}`}>{v as string}</p>
                    </div>
                  ))}
                </div>
                {effective.indirect.length > 0 && (
                  <>
                    <p className="text-[10px] text-fg-muted mb-2">간접 보유 (소유 법인 자산 × 지분율)</p>
                    {effective.indirect.map((item) => (
                      <div key={item.corporatePartyId} className="flex items-center justify-between text-xs bg-white rounded-lg px-3 py-1.5 mb-1">
                        <span className="text-fg">{item.corporateName}</span>
                        <span className="text-fg-muted">{item.ownershipPct}% × {formatW(item.totalAssets)}</span>
                        <span className="font-semibold text-[#1428A0]">= {formatW(item.effectiveAssets)}</span>
                      </div>
                    ))}
                    <div className="mt-3 pt-3 border-t border-[#1428A0]/20 flex justify-between items-center">
                      <span className="text-xs font-semibold text-fg-muted">간접 소계</span>
                      <span className="text-sm font-bold text-fg">{formatW(effective.indirectTotal)}</span>
                    </div>
                  </>
                )}
                <div className="mt-2 pt-2 border-t border-[#1428A0]/30 flex justify-between items-center">
                  <span className="text-sm font-bold text-[#1428A0]">실질 지배자산 합계</span>
                  <span className="text-base font-extrabold text-[#1428A0]">{formatW(effective.grandTotal)}</span>
                </div>
                <p className="text-[9px] text-fg-muted/60 mt-1">※ 주식은 평균단가 기준. 시세 연결 후 정확도 높아집니다.</p>
              </div>
            )}

            {/* 관계 목록 */}
            {displayed.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm text-fg-muted mb-3">등록된 관계가 없습니다.</p>
                <button className="btn-primary text-sm px-5" onClick={() => setTab("add")}>관계 추가하기</button>
              </div>
            ) : (
              <div className="space-y-2">
                {displayed.map((rel) => (
                  <div key={rel.id} className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${rel.validTo ? "border-border bg-surface-2 opacity-60" : "border-border bg-card"}`}>
                    <RelBadge type={rel.relationType} />
                    <span className="flex-1 text-sm text-fg">{getRelLabel(rel)}</span>
                    {rel.relationType === "owns" && rel.fromPartyId === partyId && (
                      <span className="text-xs text-fg-muted">{rel.ownershipPct}%</span>
                    )}
                    <span className="text-xs text-fg-muted">{rel.validFrom}</span>
                    {rel.validTo ? (
                      <span className="text-[10px] text-fg-muted/60">→ {rel.validTo}</span>
                    ) : (
                      <button
                        onClick={() => handleClose(rel.id)}
                        disabled={closing === rel.id}
                        className="text-xs text-red-400 hover:text-red-600 font-medium disabled:opacity-40">
                        종료
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between pt-1">
              <button className="text-xs text-fg-muted hover:text-fg underline"
                onClick={() => setShowHistory(!showHistory)}>
                {showHistory ? "현재 유효한 관계만 보기" : `이력 포함 전체 보기 (${allRels.length}건)`}
              </button>
              <button className="btn-outline text-xs py-1 px-3" onClick={() => setTab("add")}>+ 관계 추가</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── 추가 탭 ──
  const selectedOpt = VIEW_OPTIONS.find((o) => o.value === viewOption)!;
  const isOwns = viewOption === "owns";

  return (
    <div>
      {tabBar}
      <div className="space-y-4">
        {/* 관계 유형 */}
        <div>
          <label className="label">이 고객 기준 관계 유형</label>
          <select className="input" value={viewOption} onChange={(e) => setViewOption(e.target.value)}>
            {VIEW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {viewOption === "child_as_child" && (
            <p className="text-xs text-fg-muted mt-1">규칙: from=부모 → to=자녀. 상대방이 부모로 저장됩니다.</p>
          )}
        </div>

        {/* 상대방 검색 */}
        <div ref={dropRef} className="relative">
          <label className="label">상대방 검색 (이름)</label>
          <input
            className="input"
            placeholder="이름으로 검색…"
            value={targetQuery}
            onChange={(e) => {
              setTargetQuery(e.target.value);
              setSelectedTarget(null);
            }}
            onBlur={() => setTimeout(() => setTargetDropdown(false), 150)}
          />
          {targetDropdown && targetResults.length > 0 && (
            <div className="absolute z-50 top-full left-0 right-0 bg-white border border-border rounded-xl shadow-lg mt-1 overflow-hidden">
              {targetResults.map((r) => (
                <button key={r.id} type="button"
                  className="w-full text-left px-3 py-2 text-sm hover:bg-surface-2 flex items-center gap-2"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setSelectedTarget({ id: r.id, displayName: r.displayName });
                    setTargetQuery(r.displayName);
                    setTargetDropdown(false);
                  }}>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${r.partyType === "corporate" ? "bg-[#1428A0]/10 text-[#1428A0]" : "bg-green-50 text-green-700"}`}>
                    {r.partyType === "corporate" ? "법인" : "개인"}
                  </span>
                  {r.displayName}
                </button>
              ))}
            </div>
          )}
          {selectedTarget && (
            <p className="text-xs text-[#1428A0] mt-0.5">선택됨: {selectedTarget.displayName}</p>
          )}
        </div>

        {/* 지분율 (owns일 때만) */}
        {isOwns && (
          <div>
            <label className="label">지분율 (%)</label>
            <input className="input" type="number" min={0.01} max={100} step={0.01}
              placeholder="60.0"
              value={ownershipPct}
              onChange={(e) => setOwnershipPct(e.target.value)} />
          </div>
        )}

        {/* 적용 시작일 */}
        <div>
          <label className="label">적용 시작일</label>
          <input className="input" type="date" value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)} />
        </div>

        {msg && (
          <p className={`rounded-lg px-4 py-2 text-sm font-medium ${msg.ok ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
            {msg.ok ? "✓ " : "✕ "}{msg.text}
          </p>
        )}

        <button
          className="w-full btn-primary py-3 text-sm font-bold disabled:opacity-50"
          disabled={saving}
          onClick={handleAdd}>
          {saving ? "저장 중…" : "관계 저장"}
        </button>
        <p className="text-[10px] text-fg-muted/70 text-center">
          ※ 관계 종료 시 삭제하지 않고 종료일을 기록해 이력을 보존합니다.
        </p>
      </div>
    </div>
  );
}
