"use client";

import { useEffect, useState } from "react";
import type {
  PbAdminCreateInput,
  PbAdminDto,
  PbAdminUpdateInput,
} from "@/lib/admin/pbAdmin.shared";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  open: boolean;
  pbs: PbAdminDto[];
  clientCountOf: (pbId: string) => number;
  onCreate: (data: PbAdminCreateInput) => Promise<PbAdminDto>;
  onUpdate: (id: string, data: PbAdminUpdateInput) => Promise<void>;
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
  const [newEmail, setNewEmail] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newEmailError, setNewEmailError] = useState("");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmployeeId, setEditEmployeeId] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editEmailError, setEditEmailError] = useState("");

  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setNewName(""); setNewEmployeeId(""); setNewPassword("");
      setNewEmail(""); setNewTitle(""); setNewPhone(""); setNewEmailError("");
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
    const trimmedEmail = newEmail.trim();
    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) {
      setNewEmailError("이메일 형식이 올바르지 않습니다.");
      return;
    }
    setNewEmailError("");
    setBusy(true);
    try {
      await onCreate({
        name: newName.trim(),
        employeeId: newEmployeeId.trim(),
        password: newPassword.trim(),
        email: trimmedEmail || undefined,
        title: newTitle.trim() || undefined,
        phone: newPhone.trim() || undefined,
      });
      setNewName(""); setNewEmployeeId(""); setNewPassword("");
      setNewEmail(""); setNewTitle(""); setNewPhone("");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (id: string) => {
    if (!editName.trim()) return;
    const trimmedEmail = editEmail.trim();
    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) {
      setEditEmailError("이메일 형식이 올바르지 않습니다.");
      return;
    }
    setEditEmailError("");
    setBusy(true);
    try {
      const patch: PbAdminUpdateInput = {
        name: editName.trim(),
        email: trimmedEmail,
        title: editTitle.trim(),
        phone: editPhone.trim(),
      };
      if (editEmployeeId.trim()) patch.employeeId = editEmployeeId.trim();
      if (editPassword.trim()) patch.password = editPassword.trim();
      await onUpdate(id, patch);
      setEditingId(null);
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (pb: PbAdminDto) => {
    setEditingId(pb.id);
    setEditName(pb.name);
    setEditEmployeeId(pb.employeeId ?? "");
    setEditPassword("");
    setEditEmail(pb.email ?? "");
    setEditTitle(pb.title ?? "");
    setEditPhone(pb.phone ?? "");
    setEditEmailError("");
  };

  const remove = async (pb: PbAdminDto) => {
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
          />
          <input
            className="input"
            type="email"
            value={newEmail}
            placeholder="이메일 (예: pb@example.com)"
            onChange={(e) => { setNewEmail(e.target.value); setNewEmailError(""); }}
          />
          {newEmailError && <p className="text-[11px] text-red-500">{newEmailError}</p>}
          <input
            className="input"
            value={newTitle}
            placeholder="직함 (예: 수석 PB)"
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <input
            className="input"
            value={newPhone}
            placeholder="연락처 (예: 010-1234-5678)"
            onChange={(e) => setNewPhone(e.target.value)}
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
          <p className="text-[11px] text-fg-muted">이메일은 고객 브리핑 메일의 회신(Reply-To) 주소로 쓰입니다.</p>
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
                      <input
                        className="input"
                        type="email"
                        value={editEmail}
                        placeholder="이메일 (예: pb@example.com)"
                        onChange={(e) => { setEditEmail(e.target.value); setEditEmailError(""); }}
                      />
                      {editEmailError && <p className="text-[11px] text-red-500">{editEmailError}</p>}
                      <input
                        className="input"
                        value={editTitle}
                        placeholder="직함 (예: 수석 PB)"
                        onChange={(e) => setEditTitle(e.target.value)}
                      />
                      <input
                        className="input"
                        value={editPhone}
                        placeholder="연락처 (예: 010-1234-5678)"
                        onChange={(e) => setEditPhone(e.target.value)}
                      />
                      <p className="text-[11px] text-fg-muted">이메일은 고객 브리핑 메일의 회신(Reply-To) 주소로 쓰입니다.</p>
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
