"use client";

import { useEffect, useState } from "react";
import { createExtraEventSchedule } from "@/lib/store";
import { todayKstDate } from "@/lib/advisory/pbScheduleStorage";

interface Props {
  open: boolean;
  pbId: string;
  onClose: () => void;
  onSaved: () => void;
}

export default function ExtraEventModal({ open, pbId, onClose, onSaved }: Props) {
  const [date, setDate] = useState(todayKstDate());
  const [time, setTime] = useState("14:00");
  const [title, setTitle] = useState("");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setDate(todayKstDate());
    setTime("14:00");
    setTitle("");
    setMemo("");
    setError("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const handleSave = async () => {
    setError("");
    if (!title.trim()) {
      setError("일정 제목을 입력해 주세요.");
      return;
    }
    if (!date || !time) {
      setError("날짜와 시간을 선택해 주세요.");
      return;
    }

    setSaving(true);
    try {
      await createExtraEventSchedule(pbId, {
        title: title.trim(),
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
      <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-fg">기타일정 추가</h3>
            <p className="mt-1 text-xs text-fg-muted">교육, 내부 미팅 등 PB 개인 일정을 등록합니다.</p>
          </div>
          <button type="button" className="text-sm text-fg-muted hover:text-fg" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-semibold text-fg">일정 제목</label>
            <input
              className="input py-2"
              placeholder="예: 기본지키기 교육 듣기"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-fg">날짜</label>
              <input type="date" className="input py-2" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-fg">시간</label>
              <input type="time" className="input py-2" value={time} onChange={(e) => setTime(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-fg">메모 (선택)</label>
            <textarea
              className="input min-h-[72px] py-2"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="장소, 준비물 등"
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
