"use client";

import { useEffect, useState } from "react";
import type { PB } from "@/lib/types";

interface Props {
  open: boolean;
  initial?: Pick<PB, "id" | "name"> | null; // 있으면 수정, 없으면 추가
  onSubmit: (name: string) => Promise<void> | void;
  onClose: () => void;
}

// PB 추가/수정 공용 모달 폼
export default function PBForm({ open, initial, onSubmit, onClose }: Props) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setName(initial?.name ?? "");
  }, [open, initial]);

  if (!open) return null;

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSubmit(name.trim());
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div className="card w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-fg">
          {initial ? "PB 정보 수정" : "PB 추가"}
        </h3>
        <div className="mt-4">
          <label className="label">이름</label>
          <input
            className="input"
            value={name}
            autoFocus
            placeholder="예: 김프로"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-outline" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button className="btn-gold" onClick={submit} disabled={saving || !name.trim()}>
            {saving ? "저장 중…" : initial ? "수정" : "추가"}
          </button>
        </div>
      </div>
    </div>
  );
}
