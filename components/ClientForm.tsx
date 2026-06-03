"use client";

import { useEffect, useState } from "react";
import type { Client, ClientType, PB } from "@/lib/types";
import { formatKRW } from "@/lib/format";

// 억원 단위 입력(소수점 허용) ↔ 원 변환
function eokTextToWon(text: string): number {
  const eok = parseFloat(String(text).replace(/[^0-9.]/g, ""));
  if (isNaN(eok)) return 0;
  return Math.round(eok * 100_000_000);
}
function wonToEokText(won: number): string {
  if (!won) return "";
  // 부동소수점 잡음 방지: 만원 단위로 반올림 후 억 단위 표기
  return String(Math.round(won / 10_000) / 10_000);
}

export interface ClientFormValue {
  code: string;
  clientType: ClientType;
  name: string;
  birthDate: string;
  assignedPbId: string;
  assetSize: number;
}

interface Props {
  open: boolean;
  initial?: Client | null; // 있으면 수정
  pbs: PB[];
  defaultPbId?: string; // PB 페이지에서 추가 시 자동 지정
  suggestedCode: string; // 신규일 때 자동 식별코드
  onSubmit: (v: ClientFormValue) => Promise<void> | void;
  onClose: () => void;
}

// 고객 추가/수정 공용 폼
export default function ClientForm({
  open,
  initial,
  pbs,
  defaultPbId,
  suggestedCode,
  onSubmit,
  onClose,
}: Props) {
  const [clientType, setClientType] = useState<ClientType>("individual");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [assignedPbId, setAssignedPbId] = useState("");
  const [assetText, setAssetText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setClientType(initial.clientType);
      setName(initial.name);
      setCode(initial.code);
      setBirthDate(initial.birthDate);
      setAssignedPbId(initial.assignedPbId);
      setAssetText(wonToEokText(initial.assetSize));
    } else {
      setClientType("individual");
      setName("");
      setCode(suggestedCode);
      setBirthDate("");
      setAssignedPbId(defaultPbId ?? pbs[0]?.id ?? "");
      setAssetText("");
    }
  }, [open, initial, suggestedCode, defaultPbId, pbs]);

  if (!open) return null;

  const isCorp = clientType === "corporate";
  const assetSize = eokTextToWon(assetText);

  const submit = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSubmit({
        code: code.trim(),
        clientType,
        name: name.trim(),
        birthDate,
        assignedPbId,
        assetSize,
      });
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
      <div
        className="card w-full max-w-md p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-fg">
          {initial ? "고객 정보 수정" : "고객 추가"}
        </h3>

        {/* 개인/법인 토글 */}
        <div className="mt-4 inline-flex rounded-lg border border-border bg-surface-2 p-1">
          {(["individual", "corporate"] as ClientType[]).map((t) => (
            <button
              key={t}
              onClick={() => setClientType(t)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                clientType === t
                  ? "bg-navy-800 text-white dark:bg-navy-600"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              {t === "individual" ? "개인" : "법인"}
            </button>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label">{isCorp ? "법인명" : "이름"}</label>
            <input
              className="input"
              value={name}
              autoFocus
              placeholder={isCorp ? "예: (주)한빛테크" : "예: 박서준"}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div>
            <label className="label">식별코드</label>
            <input
              className="input font-mono"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <div>
            <label className="label">{isCorp ? "설립일" : "생년월일"}</label>
            <input
              type="date"
              className="input"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
            />
          </div>

          <div>
            <label className="label">담당 PB</label>
            <select
              className="input"
              value={assignedPbId}
              onChange={(e) => setAssignedPbId(e.target.value)}
            >
              <option value="">미지정</option>
              {pbs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">자산규모 (억원)</label>
            <div className="relative">
              <input
                className="input pr-10 text-right"
                inputMode="decimal"
                value={assetText}
                placeholder="예: 12.5"
                onChange={(e) =>
                  setAssetText(e.target.value.replace(/[^0-9.]/g, ""))
                }
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-fg-muted">
                억
              </span>
            </div>
            <p className="mt-1 text-right text-xs text-gold-600 dark:text-gold-300">
              {assetSize ? formatKRW(assetSize) : "—"}
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-outline" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button
            className="btn-gold"
            onClick={submit}
            disabled={saving || !name.trim()}
          >
            {saving ? "저장 중…" : initial ? "수정" : "추가"}
          </button>
        </div>
      </div>
    </div>
  );
}
