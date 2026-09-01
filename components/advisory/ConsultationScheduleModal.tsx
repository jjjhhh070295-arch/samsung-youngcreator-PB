"use client";

import { useEffect, useMemo, useState } from "react";
import type { Client, ClientType, PB } from "@/lib/types";
import { CLIENT_TYPE_LABEL } from "@/lib/types";
import { createClient, nextClientCode } from "@/lib/store";
import { addConsultationSchedule, todayKstDate } from "@/lib/advisory/pbScheduleStorage";
import ClientAvatar from "@/components/ClientAvatar";

type Mode = "existing" | "new";

interface Props {
  open: boolean;
  pbId: string;
  clients: Client[];
  pbs: PB[];
  allClients: Client[];
  onClose: () => void;
  onSaved: () => void;
}

export default function ConsultationScheduleModal({
  open,
  pbId,
  clients,
  pbs,
  allClients,
  onClose,
  onSaved,
}: Props) {
  const [mode, setMode] = useState<Mode>("existing");
  const [search, setSearch] = useState("");
  const [clientId, setClientId] = useState("");
  const [date, setDate] = useState(todayKstDate());
  const [time, setTime] = useState("10:00");
  const [memo, setMemo] = useState("");
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<ClientType>("individual");
  const [newBirthDate, setNewBirthDate] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setMode("existing");
    setSearch("");
    setClientId(clients[0]?.id ?? "");
    setDate(todayKstDate());
    setTime("10:00");
    setMemo("");
    setNewName("");
    setNewType("individual");
    setNewBirthDate("");
    setError("");
  }, [open, clients]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [clients, search]);

  const selectedClient = clients.find((c) => c.id === clientId) ?? null;

  const handleSave = async () => {
    setError("");
    if (!date || !time) {
      setError("날짜와 시간을 선택해 주세요.");
      return;
    }
    if (mode === "new" && !newName.trim()) {
      setError("신규 고객 이름을 입력해 주세요.");
      return;
    }
    if (mode === "existing" && !clientId) {
      setError("상담할 고객을 선택해 주세요.");
      return;
    }

    setSaving(true);
    try {
      let targetId = clientId;
      let targetName = selectedClient?.name ?? "";

      if (mode === "new") {
        const created = await createClient({
          code: nextClientCode(allClients),
          clientType: newType,
          name: newName.trim(),
          birthDate: newBirthDate,
          assignedPbId: pbId,
          assetSize: 0,
          linkedClientId: null,
          ownershipPct: null,
          isMajorityShareholder: null,
          accountSeparation: null,
          email: "",
          emailOptIn: false,
        });
        targetId = created.id;
        targetName = created.name;
      }

      addConsultationSchedule(pbId, {
        clientId: targetId,
        clientName: targetName,
        date,
        time,
        memo: memo.trim() || undefined,
      });
      onSaved();
      onClose();
    } catch (e) {
      console.error(e);
      setError("일정 저장에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="card max-h-[90vh] w-full max-w-lg overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-fg">상담일정 예약</h3>
            <p className="mt-1 text-xs text-fg-muted">고객 상담 일정을 등록하면 오늘 PB의 할일에 표시됩니다.</p>
          </div>
          <button type="button" className="text-sm text-fg-muted hover:text-fg" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="mt-4 flex gap-2">
          {([
            ["existing", "기존 고객"],
            ["new", "신규 고객 상담 예약"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                mode === id ? "bg-[#1428A0] text-white" : "bg-surface-2 text-fg-muted hover:text-fg"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "existing" ? (
          <div className="mt-4 space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-fg">고객 검색</label>
              <input
                className="input py-2"
                placeholder="이름 또는 식별코드"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
              {filteredClients.length === 0 ? (
                <p className="px-2 py-3 text-xs text-fg-muted">검색 결과가 없습니다.</p>
              ) : (
                filteredClients.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setClientId(c.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left ${
                      clientId === c.id ? "bg-[#1428A0]/10 ring-1 ring-[#1428A0]/30" : "hover:bg-surface-2"
                    }`}
                  >
                    <ClientAvatar name={c.name} type={c.clientType} size="sm" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-fg">{c.name}</span>
                      <span className="text-[10px] text-fg-muted">
                        {c.code} · {CLIENT_TYPE_LABEL[c.clientType]}
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-fg">고객명</label>
              <input className="input py-2" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-fg">구분</label>
              <select
                className="input py-2"
                value={newType}
                onChange={(e) => setNewType(e.target.value as ClientType)}
              >
                {(["individual", "corporate", "sole_proprietor"] as const).map((t) => (
                  <option key={t} value={t}>
                    {CLIENT_TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-fg">생년월일/설립일</label>
              <input
                type="date"
                className="input py-2"
                value={newBirthDate}
                onChange={(e) => setNewBirthDate(e.target.value)}
              />
            </div>
            <p className="sm:col-span-2 text-[11px] text-fg-muted">
              저장 시 고객이 먼저 생성된 뒤 상담 일정이 등록됩니다. (담당 PB: {pbs.find((p) => p.id === pbId)?.name ?? pbId})
            </p>
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold text-fg">상담 날짜</label>
            <input type="date" className="input py-2" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-fg">상담 시간</label>
            <input type="time" className="input py-2" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-fg">메모 (선택)</label>
            <textarea
              className="input min-h-[72px] py-2"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="상담 준비 사항 등"
            />
          </div>
        </div>

        {error ? <p className="mt-3 text-xs font-semibold text-red-600">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn-outline" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? "저장 중…" : "일정 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
