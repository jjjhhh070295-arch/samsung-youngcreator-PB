"use client";

import { useEffect, useState } from "react";
import type { PB } from "@/lib/types";

interface Props {
  open: boolean;
  pbs: PB[];
  clientCountOf: (pbId: string) => number;
  onCreate: (name: string) => Promise<void>;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

// PB 추가·수정·삭제를 한 곳에서 관리하는 모달
export default function PBManageModal({
  open,
  pbs,
  clientCountOf,
  onCreate,
  onRename,
  onDelete,
  onClose,
}: Props) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setNewName("");
      setEditingId(null);
      setEditName("");
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
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await onCreate(newName.trim());
      setNewName("");
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = async (id: string) => {
    if (!editName.trim()) return;
    setBusy(true);
    try {
      await onRename(id, editName.trim());
      setEditingId(null);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (pb: PB) => {
    const n = clientCountOf(pb.id);
    const msg =
      n > 0
        ? `${pb.name}(${pb.code})를 삭제할까요?\n담당 고객 ${n}명은 삭제되지 않고 담당 PB가 '미지정'으로 바뀝니다.`
        : `${pb.name}(${pb.code})를 삭제할까요?`;
    if (!window.confirm(msg)) return;
    setBusy(true);
    try {
      await onDelete(pb.id);
    } finally {
      setBusy(false);
    }
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
        <div className="flex items-center justify-between border-b border-border bg-navy-800 px-5 py-3 text-white dark:bg-navy-900">
          <p className="text-sm font-bold">PB 정보 관리</p>
          <button
            className="rounded-full px-3 py-1 text-white/70 hover:bg-white/10 hover:text-white"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* 추가 */}
        <div className="border-b border-border p-4">
          <label className="label">새 PB 추가</label>
          <div className="flex gap-2">
            <input
              className="input"
              value={newName}
              placeholder="이름 (예: 김프로)"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
            <button className="btn-gold shrink-0 text-sm" onClick={add} disabled={busy || !newName.trim()}>
              + 추가
            </button>
          </div>
          <p className="mt-1 text-[11px] text-fg-muted">식별코드(PB-00X)는 자동 부여됩니다.</p>
        </div>

        {/* 목록 (수정/삭제) */}
        <div className="flex-1 overflow-y-auto p-4">
          <p className="mb-2 text-xs font-semibold text-fg-muted">등록된 PB ({pbs.length})</p>
          {pbs.length === 0 ? (
            <p className="py-6 text-center text-sm text-fg-muted">아직 등록된 PB가 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {pbs.map((pb) => (
                <li key={pb.id} className="rounded-lg border border-border p-3">
                  {editingId === pb.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        className="input"
                        value={editName}
                        autoFocus
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveEdit(pb.id)}
                      />
                      <button
                        className="btn-gold shrink-0 text-xs"
                        onClick={() => saveEdit(pb.id)}
                        disabled={busy || !editName.trim()}
                      >
                        저장
                      </button>
                      <button
                        className="btn-outline shrink-0 text-xs"
                        onClick={() => setEditingId(null)}
                      >
                        취소
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="badge-gold font-mono">{pb.code}</span>
                        <span className="text-sm font-medium text-fg">{pb.name}</span>
                        <span className="text-xs text-fg-muted">
                          · 고객 {clientCountOf(pb.id)}명
                        </span>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <button
                          className="btn-ghost h-7 px-2 text-xs"
                          onClick={() => {
                            setEditingId(pb.id);
                            setEditName(pb.name);
                          }}
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
          <button className="btn-primary text-sm" onClick={onClose}>
            완료
          </button>
        </div>
      </div>
    </div>
  );
}
