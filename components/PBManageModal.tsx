"use client";

import { useEffect, useState } from "react";
import type { PB } from "@/lib/types";
import { setPbCredentials, getEmployeeId } from "@/lib/auth";

interface Props {
  open: boolean;
  pbs: PB[];
  clientCountOf: (pbId: string) => number;
  onCreate: (data: { name: string; employeeId: string; password: string }) => Promise<PB>;
  onUpdate: (id: string, data: { name?: string; employeeId?: string; password?: string }) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

export default function PBManageModal({
  open,
  pbs,
  clientCountOf,
  onCreate,
  onUpdate,
  onDelete,
  onClose,
}: Props) {
  const [newName, setNewName] = useState("");
  const [newEmployeeId, setNewEmployeeId] = useState("");
  const [newPassword, setNewPassword] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmployeeId, setEditEmployeeId] = useState("");
  const [editPassword, setEditPassword] = useState("");

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setNewName(""); setNewEmployeeId(""); setNewPassword("");
      setEditingId(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const add = async () => {
    if (!newName.trim() || !newEmployeeId.trim() || !newPassword.trim()) return;
    setBusy(true);
    try {
      const pb = await onCreate({ name: newName.trim(), employeeId: newEmployeeId.trim(), password: newPassword.trim() });
      setPbCredentials(pb.id, newEmployeeId.trim(), newPassword.trim());
      setNewName(""); setNewEmployeeId(""); setNewPassword("");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (id: string) => {
    if (!editName.trim()) return;
    setBusy(true);
    try {
      await onUpdate(id, { name: editName.trim() });
      const newEmpId = editEmployeeId.trim();
      const newPwd = editPassword.trim();
      if (newEmpId || newPwd) {
        const current = getEmployeeId(id);
        setPbCredentials(id, newEmpId || current, newPwd || "1234");
      }
      setEditingId(null);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (pb: PB) => {
    setEditingId(pb.id);
    setEditName(pb.name);
    setEditEmployeeId(pb.employeeId ?? "");
    setEditPassword("");
  };

  const remove = async (pb: PB) => {
    const n = clientCountOf(pb.id);
    const msg =
      n > 0
        ? `${pb.name} PB를 삭제할까요?\n담당 고객 ${n}명은 삭제되지 않고 담당 PB가 '미지정'으로 바뀝니다.`
        : `${pb.name} PB를 삭제할까요?`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try { await onDelete(pb.id); }
    finally { setBusy(false); }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/60 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-md flex-col overflow-hidden bg-surface shadow-2xl sm:max-h-[90vh] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between border-b border-border bg-[#1428A0] px-5 py-3 text-white">
          <p className="text-sm font-bold">PB 정보 관리</p>
          <button
            className="rounded-full px-3 py-1 text-white/70 hover:bg-white/10 hover:text-white"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* 새 PB 추가 */}
        <div className="border-b border-border p-4 space-y-2">
          <label className="label">새 PB 추가</label>
          <input
            className="input"
            value={newName}
            placeholder="이름 (예: 김프로)"
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            className="input"
            value={newEmployeeId}
            placeholder="사원번호 (예: EMP-001)"
            onChange={(e) => setNewEmployeeId(e.target.value)}
          />
          <input
            className="input"
            type="password"
            value={newPassword}
            placeholder="비밀번호"
            onChange={(e) => setNewPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
          />
          <button
            className="btn-primary w-full text-sm"
            onClick={add}
            disabled={busy || !newName.trim() || !newEmployeeId.trim() || !newPassword.trim()}
          >
            + PB 추가
          </button>
          <p className="text-[11px] text-fg-muted">식별코드(PB-00X)는 자동 부여됩니다.</p>
        </div>

        {/* 목록 */}
        <div className="flex-1 overflow-y-auto p-4">
          <p className="mb-2 text-xs font-semibold text-fg-muted">등록된 PB ({pbs.length})</p>
          {pbs.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">아직 등록된 PB가 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {pbs.map((pb) => (
                <li key={pb.id} className="rounded-lg border border-border p-3">
                  {editingId === pb.id ? (
                    <div className="space-y-2">
                      <input
                        className="input"
                        value={editName}
                        autoFocus
                        placeholder="이름"
                        onChange={(e) => setEditName(e.target.value)}
                      />
                      <input
                        className="input"
                        value={editEmployeeId}
                        placeholder="사원번호"
                        onChange={(e) => setEditEmployeeId(e.target.value)}
                      />
                      <input
                        className="input"
                        type="password"
                        value={editPassword}
                        placeholder="새 비밀번호 (변경 시만 입력)"
                        onChange={(e) => setEditPassword(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          className="btn-primary flex-1 text-xs"
                          onClick={() => saveEdit(pb.id)}
                          disabled={busy || !editName.trim()}
                        >
                          저장
                        </button>
                        <button
                          className="btn-outline flex-1 text-xs"
                          onClick={() => setEditingId(null)}
                        >
                          취소
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="text-sm font-medium text-fg">{pb.name}</span>
                        <span className="ml-2 text-xs text-fg-muted">{pb.code}</span>
                        {pb.employeeId && (
                          <span className="ml-2 text-xs text-fg-muted">· {pb.employeeId}</span>
                        )}
                        <span className="ml-2 text-xs text-fg-muted">
                          · 고객 {clientCountOf(pb.id)}명
                        </span>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          className="btn-ghost h-7 px-2 text-xs"
                          onClick={() => startEdit(pb)}
                        >
                          수정
                        </button>
                        <button
                          className="btn-ghost h-7 px-2 text-xs text-red-500"
                          onClick={() => remove(pb)}
                          disabled={busy}
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-border px-5 py-3 text-right">
          <button className="btn-primary text-sm" onClick={onClose}>완료</button>
        </div>
      </div>
    </div>
  );
}
