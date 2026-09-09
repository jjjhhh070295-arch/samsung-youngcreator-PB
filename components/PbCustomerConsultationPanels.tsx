"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Client, Consultation } from "@/lib/types";
import { CLIENT_TYPE_LABEL } from "@/lib/types";
import { formatDate, formatDateTime, formatDurationKo } from "@/lib/format";
import ClientAvatar from "@/components/ClientAvatar";
import ConsultationDetailModal from "@/components/ConsultationDetailModal";
import { updateConsultationNote } from "@/lib/store";
import {
  buildClientListRows,
  canViewFinalIps,
  compositionCounts,
  consultationsForClient,
  memoPreview,
  sanitizeSelectedClientId,
} from "@/lib/pbHomeConsultationPanels";

type Props = {
  pbId: string;
  clients: Client[];
  consultations: Consultation[];
  onConsultationsChange: (next: Consultation[]) => void;
  onRequestReload?: () => void | Promise<void>;
};

const COLLAPSED_PANEL_MIN_H = "min-h-[148px]";

export default function PbCustomerConsultationPanels({
  pbId,
  clients,
  consultations,
  onConsultationsChange,
  onRequestReload,
}: Props) {
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [compositionExpanded, setCompositionExpanded] = useState(false);
  const [logExpanded, setLogExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftById, setDraftById] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [detailConsultation, setDetailConsultation] = useState<Consultation | null>(null);

  const assignedClients = useMemo(
    () => clients.filter((c) => c.assignedPbId === pbId),
    [clients, pbId],
  );
  const assignedIds = useMemo(() => new Set(assignedClients.map((c) => c.id)), [assignedClients]);
  const counts = useMemo(() => compositionCounts(assignedClients), [assignedClients]);
  const rows = useMemo(
    () => buildClientListRows(clients, consultations, pbId),
    [clients, consultations, pbId],
  );

  const safeSelectedId = sanitizeSelectedClientId(selectedClientId, assignedIds);
  useEffect(() => {
    if (selectedClientId !== safeSelectedId) setSelectedClientId(safeSelectedId);
  }, [selectedClientId, safeSelectedId]);

  const selectedClient = assignedClients.find((c) => c.id === safeSelectedId) ?? null;
  const selectedLogs = useMemo(() => {
    if (!safeSelectedId) return [];
    return consultationsForClient({
      consultations,
      pbId,
      clientId: safeSelectedId,
      assignedClientIds: assignedIds,
    });
  }, [consultations, pbId, safeSelectedId, assignedIds]);

  const collapsedLogs = selectedLogs.slice(0, 2);
  const ipsEligible = canViewFinalIps(selectedClient, pbId);

  const anyExpanded = compositionExpanded || logExpanded;
  const gridClass = anyExpanded
    ? "grid grid-cols-1 border border-border bg-white"
    : "grid grid-cols-1 border border-border bg-white md:grid-cols-2";

  const openEditor = (c: Consultation) => {
    setEditingId(c.id);
    setDraftById((prev) => ({ ...prev, [c.id]: prev[c.id] ?? c.notes ?? "" }));
    setStatusMsg(null);
  };

  const cancelEditor = (id: string) => {
    setEditingId((cur) => (cur === id ? null : cur));
  };

  const saveMemo = async (c: Consultation) => {
    if (savingId) return;
    if (!safeSelectedId) return;
    const draft = (draftById[c.id] ?? c.notes ?? "").replace(/^\s+|\s+$/g, "");
    setSavingId(c.id);
    setStatusMsg(null);
    try {
      const updated = await updateConsultationNote({
        id: c.id,
        pbId,
        clientId: safeSelectedId,
        notes: draft,
      });
      onConsultationsChange(
        consultations.map((row) => (row.id === updated.id ? { ...row, notes: updated.notes } : row)),
      );
      setEditingId(null);
      setDraftById((prev) => {
        const next = { ...prev };
        delete next[c.id];
        return next;
      });
      setStatusMsg({ kind: "ok", text: "메모를 저장했습니다." });
    } catch (e) {
      setStatusMsg({
        kind: "err",
        text: e instanceof Error ? e.message : "메모 저장에 실패했습니다.",
      });
    } finally {
      setSavingId(null);
    }
  };

  const renderLogRow = (c: Consultation) => {
    const preview = memoPreview(c.notes);
    const editing = editingId === c.id;
    const draft = draftById[c.id] ?? c.notes ?? "";
    return (
      <li key={c.id} className="border-b border-border/60 py-2.5 last:border-0">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-fg">{formatDateTime(c.createdAt)}</p>
            <p className="mt-0.5 text-[10px] text-fg-muted">소요 {formatDurationKo(c.durationSeconds)}</p>
            {!editing && (
              <p className="mt-1 truncate text-[11px] text-slate-600">
                {preview || <span className="text-fg-muted">메모 없음</span>}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {!editing && (
              <button
                type="button"
                className="min-h-[40px] rounded border border-border bg-white px-2.5 text-[11px] font-bold text-[#1428A0] hover:bg-slate-50"
                onClick={() => openEditor(c)}
              >
                {preview ? "메모 수정" : "메모 작성"}
              </button>
            )}
            <button
              type="button"
              className="min-h-[40px] rounded border border-transparent px-2 text-[11px] font-semibold text-fg-muted hover:bg-slate-50"
              onClick={() => setDetailConsultation(c)}
            >
              상담 상세
            </button>
          </div>
        </div>
        {editing && (
          <div className="mt-2 space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraftById((prev) => ({ ...prev, [c.id]: e.target.value }))}
              rows={3}
              className="w-full resize-y rounded border border-border bg-white px-2.5 py-2 text-xs text-fg outline-none focus:border-[#1428A0]"
              placeholder="상담 메모를 입력하세요"
              aria-label="상담 메모"
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="min-h-[40px] rounded bg-[#1428A0] px-3 text-[11px] font-bold text-white disabled:opacity-50"
                disabled={savingId === c.id}
                onClick={() => void saveMemo(c)}
              >
                {savingId === c.id ? "저장 중" : "저장"}
              </button>
              <button
                type="button"
                className="min-h-[40px] rounded border border-border bg-white px-3 text-[11px] font-bold text-fg disabled:opacity-50"
                disabled={savingId === c.id}
                onClick={() => cancelEditor(c.id)}
              >
                취소
              </button>
            </div>
          </div>
        )}
      </li>
    );
  };

  return (
    <div className={gridClass}>
      <section
        className={`relative border-b border-border p-4 ${
          anyExpanded ? "" : "md:border-b-0 md:border-r"
        } ${compositionExpanded ? "" : COLLAPSED_PANEL_MIN_H}`}
        aria-labelledby="pb-home-composition-title"
      >
        <span className="absolute left-4 top-2 h-[3px] w-16 rounded bg-[#1769D2]" aria-hidden="true" />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#1428A0]">Book Insight</p>
            <h2 id="pb-home-composition-title" className="mt-0.5 text-sm font-black text-fg">
              고객 구성
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="badge-muted">총 {counts.total}명</span>
            <button
              type="button"
              className="min-h-[40px] min-w-[72px] rounded border border-border bg-white px-3 text-[11px] font-bold text-[#1428A0] hover:bg-slate-50"
              aria-expanded={compositionExpanded}
              aria-controls="pb-home-composition-detail"
              onClick={() => setCompositionExpanded((v) => !v)}
            >
              {compositionExpanded ? "접기" : "상세보기"}
            </button>
          </div>
        </div>

        <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-slate-100" aria-label="고객 유형 구성">
          {counts.total > 0 && (
            <>
              <span className="bg-[#1769D2]" style={{ width: `${(counts.individual / counts.total) * 100}%` }} />
              <span className="bg-[#84B2EE]" style={{ width: `${(counts.corporate / counts.total) * 100}%` }} />
              <span className="bg-slate-400" style={{ width: `${(counts.soleProprietor / counts.total) * 100}%` }} />
            </>
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-xs text-slate-600">
          <span>
            <i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#1428A0]" />
            개인 {counts.individual}명
          </span>
          <span>
            <i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[#2563EB]" />
            법인 {counts.corporate}명
          </span>
          <span>
            <i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-slate-400" />
            개인사업자 {counts.soleProprietor}명
          </span>
        </div>

        <div id="pb-home-composition-detail" hidden={!compositionExpanded} className="mt-3">
          {rows.length === 0 ? (
            <p className="rounded-lg bg-slate-50 px-3 py-4 text-xs text-fg-muted">담당 고객이 없습니다.</p>
          ) : (
            <ul className="max-h-[320px] space-y-0 overflow-y-auto border-t border-border/80" role="listbox" aria-label="담당 고객 목록">
              {rows.map((row) => {
                const selected = row.id === safeSelectedId;
                return (
                  <li key={row.id} className="border-b border-border/50 last:border-0">
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      aria-current={selected ? "true" : undefined}
                      className={`flex w-full min-h-[44px] items-center gap-2.5 px-1 py-2.5 text-left transition ${
                        selected ? "bg-[#1428A0]/8" : "hover:bg-slate-50"
                      }`}
                      onClick={() => {
                        setSelectedClientId(row.id);
                        setEditingId(null);
                        setStatusMsg(null);
                      }}
                    >
                      <ClientAvatar name={row.name} type={row.clientType} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-bold text-fg">{row.name}</span>
                        <span className="block truncate text-[10px] text-fg-muted">
                          {row.code} · {CLIENT_TYPE_LABEL[row.clientType]}
                          {row.consultationCount > 0
                            ? ` · 상담 ${row.consultationCount}건`
                            : " · 상담 없음"}
                          {row.latestConsultationAt
                            ? ` · 최근 ${formatDate(row.latestConsultationAt)}`
                            : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section
        className={`relative p-4 ${anyExpanded ? "border-t border-border" : ""} ${
          logExpanded ? "" : COLLAPSED_PANEL_MIN_H
        }`}
        aria-labelledby="pb-home-log-title"
      >
        <span className="absolute left-4 top-2 h-1.5 w-1.5 rounded-full bg-[#1769D2]" aria-hidden="true" />
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 id="pb-home-log-title" className="text-sm font-bold text-fg">
              상담로그
            </h2>
            {selectedClient ? (
              <p className="mt-0.5 truncate text-[11px] text-fg-muted">
                {selectedClient.name} · 총 {selectedLogs.length}건
              </p>
            ) : (
              <p className="mt-0.5 text-[11px] text-fg-muted">고객 선택 대기</p>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {selectedClient &&
              (ipsEligible ? (
                <Link
                  href={`/pb/${pbId}/${selectedClient.id}/ips`}
                  className="inline-flex min-h-[40px] items-center rounded border border-[#1428A0] bg-white px-3 text-[11px] font-bold text-[#1428A0] hover:bg-[#1428A0]/5"
                >
                  IPS 보기
                </Link>
              ) : (
                <span className="text-[10px] font-semibold text-fg-muted">발행된 IPS 없음</span>
              ))}
            <button
              type="button"
              className="min-h-[40px] min-w-[72px] rounded border border-border bg-white px-3 text-[11px] font-bold text-[#1428A0] hover:bg-slate-50"
              aria-expanded={logExpanded}
              aria-controls="pb-home-log-detail"
              onClick={() => setLogExpanded((v) => !v)}
            >
              {logExpanded ? "접기" : "상세보기"}
            </button>
          </div>
        </div>

        {statusMsg && (
          <p
            className={`mt-2 text-[11px] font-semibold ${
              statusMsg.kind === "ok" ? "text-emerald-700" : "text-rose-700"
            }`}
            role="status"
          >
            {statusMsg.text}
          </p>
        )}

        {!selectedClient ? (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-4 text-xs text-fg-muted">
            고객을 선택하면 상담 이력을 확인할 수 있습니다.
          </p>
        ) : selectedLogs.length === 0 ? (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-4 text-xs text-fg-muted">
            이 고객의 상담 이력이 없습니다.
          </p>
        ) : (
          <>
            {!logExpanded && (
              <ul className="mt-2">{collapsedLogs.map(renderLogRow)}</ul>
            )}
            <div id="pb-home-log-detail" hidden={!logExpanded}>
              <ul className="mt-2 max-h-[360px] overflow-y-auto">{selectedLogs.map(renderLogRow)}</ul>
            </div>
          </>
        )}
      </section>

      <ConsultationDetailModal
        consultation={detailConsultation}
        client={selectedClient}
        onClose={() => setDetailConsultation(null)}
        onSaved={() => {
          setDetailConsultation(null);
          void onRequestReload?.();
          setStatusMsg({ kind: "ok", text: "상담 상세를 저장했습니다." });
        }}
      />
    </div>
  );
}
