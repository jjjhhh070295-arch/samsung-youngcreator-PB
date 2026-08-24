"use client";

import { useCallback, useEffect, useState } from "react";
import {
  TRANSFER_EVENT_LABEL,
  ASSET_KIND_LABEL,
  type TransferEvent,
  type TransferEventType,
  type AssetKind,
  type GiftPairSummary,
} from "@/lib/types";
import {
  listTransferEvents,
  createTransferEvent,
  deleteTransferEvent,
  listGiftSummaries10y,
  searchParties,
} from "@/lib/store";
import { formatKRW, formatDate } from "@/lib/format";

const ASSET_KIND_OPTIONS: { value: AssetKind; label: string }[] = [
  { value: "cash",         label: ASSET_KIND_LABEL.cash },
  { value: "stock",        label: ASSET_KIND_LABEL.stock },
  { value: "real_estate",  label: ASSET_KIND_LABEL.real_estate },
  { value: "corp_share",   label: ASSET_KIND_LABEL.corp_share },
  { value: "other",        label: ASSET_KIND_LABEL.other },
];

type Tab = "list" | "add";

interface TransferEventModuleProps {
  partyId: string;
  partyName: string;
}

export default function TransferEventModule({ partyId, partyName }: TransferEventModuleProps) {
  const [tab, setTab]         = useState<Tab>("list");
  const [events, setEvents]   = useState<TransferEvent[]>([]);
  const [summaries, setSummaries] = useState<GiftPairSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSummary, setShowSummary] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listTransferEvents(partyId, "both");
      setEvents(data);
    } finally {
      setLoading(false);
    }
  }, [partyId]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id: string) => {
    if (!confirm("이 이벤트를 삭제할까요?")) return;
    await deleteTransferEvent(id);
    setSummaries([]);
    await load();
  };

  const handleLoadSummary = async () => {
    setShowSummary(true);
    const data = await listGiftSummaries10y(partyId);
    setSummaries(data);
  };

  const giftEvents  = events.filter((e) => e.eventType === "gift");
  const inhEvents   = events.filter((e) => e.eventType === "inheritance");

  return (
    <div className="space-y-4">
      {/* 탭 */}
      <div className="flex gap-1 border-b border-border">
        {(["list", "add"] as Tab[]).map((t) => (
          <button
            key={t}
            className={`px-3 py-1.5 text-sm font-medium rounded-t ${
              tab === t ? "bg-bg text-fg border border-b-bg border-border -mb-px" : "text-fg-muted hover:text-fg"
            }`}
            onClick={() => setTab(t)}
          >
            {t === "list" ? `이벤트 목록 (${events.length})` : "새 이벤트 등록"}
          </button>
        ))}
      </div>

      {tab === "list" && (
        <ListTab
          partyId={partyId}
          partyName={partyName}
          loading={loading}
          events={events}
          giftCount={giftEvents.length}
          inhCount={inhEvents.length}
          showSummary={showSummary}
          summaries={summaries}
          onDelete={handleDelete}
          onLoadSummary={handleLoadSummary}
        />
      )}
      {tab === "add" && (
        <AddTab
          partyId={partyId}
          partyName={partyName}
          onSaved={async () => {
            setSummaries([]);
            setShowSummary(false);
            await load();
            setTab("list");
          }}
        />
      )}
    </div>
  );
}

// ── 목록 탭 ──

function ListTab({
  partyId,
  partyName,
  loading,
  events,
  giftCount,
  inhCount,
  showSummary,
  summaries,
  onDelete,
  onLoadSummary,
}: {
  partyId: string;
  partyName: string;
  loading: boolean;
  events: TransferEvent[];
  giftCount: number;
  inhCount: number;
  showSummary: boolean;
  summaries: GiftPairSummary[];
  onDelete: (id: string) => void;
  onLoadSummary: () => void;
}) {
  if (loading) return <p className="text-sm text-fg-muted">불러오는 중…</p>;

  if (events.length === 0) {
    return <p className="text-sm text-fg-muted text-center py-6">등록된 이벤트가 없습니다.</p>;
  }

  return (
    <div className="space-y-4">
      {/* 이벤트 테이블 */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-gold-400/10 text-fg-muted">
              <th className="px-3 py-2 text-left">날짜</th>
              <th className="px-3 py-2 text-left">유형</th>
              <th className="px-3 py-2 text-left">증여자 → 수증자</th>
              <th className="px-3 py-2 text-left">자산 종류</th>
              <th className="px-3 py-2 text-right">금액</th>
              <th className="px-3 py-2 text-left">메모</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {events.map((e) => (
              <tr key={e.id} className="bg-surface hover:bg-gold-400/5">
                <td className="px-3 py-2 text-fg-muted whitespace-nowrap">{formatDate(e.eventDate)}</td>
                <td className="px-3 py-2">
                  <span className={e.eventType === "gift" ? "badge-gold" : "badge-navy"}>
                    {TRANSFER_EVENT_LABEL[e.eventType]}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={e.fromPartyId === partyId ? "font-semibold text-fg" : "text-fg-muted"}>
                    {e.fromPartyName ?? "(미상)"}
                  </span>
                  <span className="text-fg-muted mx-1">→</span>
                  <span className={e.toPartyId === partyId ? "font-semibold text-fg" : "text-fg-muted"}>
                    {e.toPartyName ?? "(미상)"}
                  </span>
                </td>
                <td className="px-3 py-2 text-fg-muted">
                  {e.assetKind ? ASSET_KIND_LABEL[e.assetKind] : "—"}
                </td>
                <td className="px-3 py-2 text-right font-medium text-fg">
                  {e.amount != null ? formatKRW(e.amount) : "—"}
                </td>
                <td className="px-3 py-2 text-fg-muted max-w-[160px] truncate">{e.note ?? ""}</td>
                <td className="px-3 py-2">
                  <button className="text-xs text-red-400 hover:text-red-600" onClick={() => onDelete(e.id)}>
                    삭제
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 합계 소계 */}
      <div className="flex gap-4 text-xs text-fg-muted">
        {giftCount > 0 && (
          <span>
            증여 {giftCount}건 ·{" "}
            <b className="text-fg">
              {formatKRW(
                events.filter((e) => e.eventType === "gift" && e.amount != null)
                  .reduce((s, e) => s + e.amount!, 0),
              )}
            </b>
          </span>
        )}
        {inhCount > 0 && (
          <span>
            상속 {inhCount}건 ·{" "}
            <b className="text-fg">
              {formatKRW(
                events.filter((e) => e.eventType === "inheritance" && e.amount != null)
                  .reduce((s, e) => s + e.amount!, 0),
              )}
            </b>
          </span>
        )}
      </div>

      {/* §7-3 증여 10년 합산 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-fg-muted">증여 10년 합산 (§7-3)</p>
          <button className="btn-outline text-xs" onClick={onLoadSummary}>
            {showSummary ? "새로고침" : "계산"}
          </button>
        </div>
        {showSummary && <GiftSummaryView partyId={partyId} summaries={summaries} />}
      </div>
    </div>
  );
}

function GiftSummaryView({
  partyId,
  summaries,
}: {
  partyId: string;
  summaries: GiftPairSummary[];
}) {
  if (summaries.length === 0) {
    return <p className="text-xs text-fg-muted">최근 10년 증여 이벤트 없음.</p>;
  }

  const given    = summaries.filter((s) => s.fromPartyId === partyId);
  const received = summaries.filter((s) => s.toPartyId   === partyId);

  return (
    <div className="space-y-3">
      {received.length > 0 && (
        <div>
          <p className="text-[11px] text-fg-muted mb-1">받은 증여 (수증자)</p>
          <SummaryTable rows={received} highlightField="from" />
        </div>
      )}
      {given.length > 0 && (
        <div>
          <p className="text-[11px] text-fg-muted mb-1">준 증여 (증여자)</p>
          <SummaryTable rows={given} highlightField="to" />
        </div>
      )}
      <p className="text-[11px] text-fg-muted">
        * 기준일 기준 최근 10년. 세율·공제는 세금 모듈에서 별도 적용.
      </p>
    </div>
  );
}

function SummaryTable({
  rows,
  highlightField,
}: {
  rows: GiftPairSummary[];
  highlightField: "from" | "to";
}) {
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gold-400/10 text-fg-muted">
            <th className="px-3 py-2 text-left">증여자</th>
            <th className="px-3 py-2 text-left">수증자</th>
            <th className="px-3 py-2 text-right">건수</th>
            <th className="px-3 py-2 text-right">10년 합산</th>
            <th className="px-3 py-2 text-left">최근 시점</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={`${r.fromPartyId}|${r.toPartyId}`} className="bg-surface">
              <td className={`px-3 py-2 ${highlightField === "from" ? "text-fg-muted" : "font-semibold text-fg"}`}>
                {r.fromPartyName}
              </td>
              <td className={`px-3 py-2 ${highlightField === "to" ? "text-fg-muted" : "font-semibold text-fg"}`}>
                {r.toPartyName}
              </td>
              <td className="px-3 py-2 text-right text-fg-muted">{r.eventCount}</td>
              <td className="px-3 py-2 text-right font-bold text-[#1428A0]">{formatKRW(r.totalAmount)}</td>
              <td className="px-3 py-2 text-fg-muted">{formatDate(r.latestEventDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 등록 탭 ──

function AddTab({
  partyId,
  partyName,
  onSaved,
}: {
  partyId: string;
  partyName: string;
  onSaved: () => void;
}) {
  const [eventType, setEventType]   = useState<TransferEventType>("gift");
  const [direction, setDirection]   = useState<"i_am_from" | "i_am_to">("i_am_to");
  const [assetKind, setAssetKind]   = useState<AssetKind>("cash");
  const [amount, setAmount]         = useState("");
  const [eventDate, setEventDate]   = useState(new Date().toISOString().split("T")[0]);
  const [note, setNote]             = useState("");
  const [saving, setSaving]         = useState(false);
  const [errMsg, setErrMsg]         = useState("");

  // 상대방 검색
  const [search, setSearch]               = useState("");
  const [searchResults, setSearchResults] = useState<{ id: string; displayName: string }[]>([]);
  const [counterparty, setCounterparty]   = useState<{ id: string; displayName: string } | null>(null);

  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      const res = await searchParties(search, partyId);
      setSearchResults(res);
    }, 250);
    return () => clearTimeout(t);
  }, [search, partyId]);

  const fromPartyId = direction === "i_am_from" ? partyId : counterparty?.id ?? null;
  const toPartyId   = direction === "i_am_to"   ? partyId : counterparty?.id ?? null;

  const handleSave = async () => {
    setErrMsg("");
    if (!toPartyId) { setErrMsg("수증자(받는 쪽)는 필수입니다."); return; }
    if (!eventDate) { setErrMsg("날짜를 입력해주세요."); return; }
    setSaving(true);
    try {
      await createTransferEvent({
        eventType,
        fromPartyId: fromPartyId ?? null,
        toPartyId,
        assetKind,
        amount: amount ? Number(amount.replace(/,/g, "")) : null,
        eventDate,
        note: note.trim() || null,
      });
      onSaved();
    } catch (e: any) {
      setErrMsg(e.message ?? "저장 실패");
    } finally {
      setSaving(false);
    }
  };

  const directionLabel = eventType === "gift"
    ? { i_am_from: `${partyName}이(가) 증여자 (주는 쪽)`, i_am_to: `${partyName}이(가) 수증자 (받는 쪽)` }
    : { i_am_from: `${partyName}이(가) 피상속인 (사망자)`, i_am_to: `${partyName}이(가) 상속인 (받는 쪽)` };

  return (
    <div className="space-y-4 max-w-lg">
      {/* 이벤트 유형 */}
      <div>
        <label className="block text-xs text-fg-muted mb-1">이벤트 유형</label>
        <div className="flex gap-2">
          {(["gift", "inheritance"] as TransferEventType[]).map((t) => (
            <button
              key={t}
              className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                eventType === t
                  ? "bg-gold-400/20 border-gold-400 text-fg font-medium"
                  : "border-border text-fg-muted hover:border-fg-muted"
              }`}
              onClick={() => setEventType(t)}
            >
              {TRANSFER_EVENT_LABEL[t]}
            </button>
          ))}
        </div>
      </div>

      {/* 방향 */}
      <div>
        <label className="block text-xs text-fg-muted mb-1">
          {partyName} 역할
        </label>
        <div className="flex gap-2">
          {(["i_am_to", "i_am_from"] as const).map((d) => (
            <button
              key={d}
              className={`px-3 py-1.5 text-sm rounded border transition-colors ${
                direction === d
                  ? "bg-gold-400/20 border-gold-400 text-fg font-medium"
                  : "border-border text-fg-muted hover:border-fg-muted"
              }`}
              onClick={() => setDirection(d)}
            >
              {directionLabel[d]}
            </button>
          ))}
        </div>
      </div>

      {/* 상대방 */}
      <div>
        <label className="block text-xs text-fg-muted mb-1">
          상대방 ({direction === "i_am_to" ? "증여자" : "수증자"})
          <span className="text-fg-muted ml-1">선택 사항 (피상속인 미상 등)</span>
        </label>
        {counterparty ? (
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-fg">{counterparty.displayName}</span>
            <button className="text-xs text-fg-muted hover:text-fg" onClick={() => setCounterparty(null)}>×</button>
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
                    className="w-full text-left px-3 py-2 text-sm hover:bg-gold-400/10"
                    onClick={() => { setCounterparty(p); setSearch(""); setSearchResults([]); }}
                  >
                    {p.displayName}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 자산 종류 */}
      <div>
        <label className="block text-xs text-fg-muted mb-1">자산 종류</label>
        <select className="input text-sm w-full" value={assetKind} onChange={(e) => setAssetKind(e.target.value as AssetKind)}>
          {ASSET_KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* 금액 */}
      <div>
        <label className="block text-xs text-fg-muted mb-1">평가액 (원)</label>
        <input
          className="input text-sm w-full"
          type="text"
          inputMode="numeric"
          placeholder="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
        />
        {amount && (
          <p className="text-xs text-fg-muted mt-1">{formatKRW(Number(amount))}</p>
        )}
      </div>

      {/* 날짜 */}
      <div>
        <label className="block text-xs text-fg-muted mb-1">이벤트 날짜</label>
        <input
          className="input text-sm"
          type="date"
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
        />
      </div>

      {/* 메모 */}
      <div>
        <label className="block text-xs text-fg-muted mb-1">메모</label>
        <textarea
          className="input text-sm w-full h-16 resize-none"
          placeholder="상속·증여 배경, 계약 내용 등"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {errMsg && <p className="text-xs text-red-500">{errMsg}</p>}

      <button
        className="btn-primary text-sm px-6"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? "저장 중…" : "저장"}
      </button>
    </div>
  );
}
