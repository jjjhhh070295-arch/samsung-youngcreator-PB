"use client";

import { useEffect, useState } from "react";
import {
  ACCOUNT_SEPARATION_LABEL,
  CLIENT_TYPE_LABEL,
  type AccountSeparation,
  type Client,
  type ClientType,
  type PB,
} from "@/lib/types";
import { formatKRW } from "@/lib/format";
import MoneyManwonInput from "@/components/MoneyManwonInput";

export interface ClientFormValue {
  code: string;
  clientType: ClientType;
  name: string;
  birthDate: string;
  assignedPbId: string;
  assetSize: number;
  linkedClientId: string | null;
  ownershipPct: number | null;
  isMajorityShareholder: boolean | null;
  accountSeparation: AccountSeparation | null;
  email: string;
  emailOptIn: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
  open: boolean;
  initial?: Client | null; // 있으면 수정
  pbs: PB[];
  clients?: Client[];
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
  clients = [],
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
  const [assetSizeWon, setAssetSizeWon] = useState<number | null>(null);
  const [linkedClientId, setLinkedClientId] = useState("");
  const [ownershipText, setOwnershipText] = useState("");
  const [isMajorityShareholder, setIsMajorityShareholder] = useState(false);
  const [accountSeparation, setAccountSeparation] = useState<AccountSeparation>("unknown");
  const [email, setEmail] = useState("");
  const [emailOptIn, setEmailOptIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [birthError, setBirthError] = useState("");
  const [emailError, setEmailError] = useState("");

  // 오늘(로컬) — 생년월일/설립일이 미래가 되지 않도록 max 로 사용
  const todayStr = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setClientType(initial.clientType);
      setName(initial.name);
      setCode(initial.code);
      setBirthDate(initial.birthDate);
      setAssignedPbId(initial.assignedPbId);
      setAssetSizeWon(initial.assetSize || null);
      setLinkedClientId(initial.linkedClientId ?? "");
      setOwnershipText(initial.ownershipPct == null ? "" : String(initial.ownershipPct));
      setIsMajorityShareholder(Boolean(initial.isMajorityShareholder));
      setAccountSeparation(initial.accountSeparation ?? "unknown");
      setEmail(initial.email ?? "");
      setEmailOptIn(Boolean(initial.emailOptIn));
    } else {
      setClientType("individual");
      setName("");
      setCode(suggestedCode);
      setBirthDate("");
      setAssignedPbId(defaultPbId ?? pbs[0]?.id ?? "");
      setAssetSizeWon(null);
      setLinkedClientId("");
      setOwnershipText("");
      setIsMajorityShareholder(false);
      setAccountSeparation("unknown");
      setEmail("");
      setEmailOptIn(false);
    }
    setEmailError("");
  }, [open, initial, suggestedCode, defaultPbId, pbs]);

  if (!open) return null;

  const isCorp = clientType === "corporate";
  const isSole = clientType === "sole_proprietor";
  const assetSize = assetSizeWon ?? 0;
  const ownershipPct = ownershipText === "" ? null : Math.min(100, Math.max(0, Number(ownershipText)));
  const linkedCandidates = clients.filter(
    (client) =>
      client.id !== initial?.id &&
      client.assignedPbId === assignedPbId &&
      (clientType === "corporate"
        ? client.clientType !== "corporate"
        : client.clientType === "corporate"),
  );

  const submit = async () => {
    if (!name.trim()) return;
    // 미래 날짜 차단 (브라우저 max 우회 입력 대비 2차 검증)
    if (birthDate && birthDate > todayStr) {
      setBirthError(`${isCorp ? "설립일" : "생년월일"}은 오늘 이후로 설정할 수 없어요.`);
      return;
    }
    if (ownershipText && !Number.isFinite(Number(ownershipText))) {
      setBirthError("지분율은 숫자로 입력해주세요.");
      return;
    }
    const trimmedEmail = email.trim();
    if (trimmedEmail && !EMAIL_RE.test(trimmedEmail)) {
      setEmailError("이메일 형식이 올바르지 않습니다.");
      return;
    }
    setEmailError("");
    setSaving(true);
    try {
      await onSubmit({
        code: code.trim(),
        clientType,
        name: name.trim(),
        birthDate,
        assignedPbId,
        assetSize,
        linkedClientId: clientType === "sole_proprietor" ? null : linkedClientId || null,
        ownershipPct: clientType === "sole_proprietor" ? null : ownershipPct,
        isMajorityShareholder: clientType === "sole_proprietor" ? null : isMajorityShareholder,
        accountSeparation: clientType === "sole_proprietor" ? accountSeparation : null,
        email: trimmedEmail,
        // 이메일이 없는데 동의만 켜져 있는 상태로 저장되지 않게 방어.
        emailOptIn: trimmedEmail ? emailOptIn : false,
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
        className="card max-h-[92vh] w-full max-w-2xl overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-fg">
          {initial ? "고객 정보 수정" : "고객 추가"}
        </h3>

        <div className="mt-4 inline-flex flex-wrap rounded-lg border border-border bg-surface-2 p-1">
          {(["individual", "corporate", "sole_proprietor"] as ClientType[]).map((t) => (
            <button
              key={t}
              onClick={() => {
                setClientType(t);
                if (t === "sole_proprietor") {
                  setLinkedClientId("");
                  setOwnershipText("");
                  setIsMajorityShareholder(false);
                }
              }}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                clientType === t
                  ? "bg-navy-800 text-white dark:bg-navy-600"
                  : "text-fg-muted hover:text-fg"
              }`}
            >
              {CLIENT_TYPE_LABEL[t]}
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
              placeholder={isCorp ? "예: (주)한빛테크" : isSole ? "예: 김대표 개인사업자" : "예: 박서준"}
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
              min="1900-01-01"
              max={todayStr}
              onChange={(e) => {
                setBirthDate(e.target.value);
                setBirthError("");
              }}
            />
            {birthError && <p className="mt-1 text-[11px] text-red-500">{birthError}</p>}
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
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <MoneyManwonInput
              className="label block"
              label="자산규모"
              valueWon={assetSizeWon}
              onCommitWon={setAssetSizeWon}
              placeholder="예: 125000"
              inputClassName="input w-full text-right tabular-nums"
            />
            <p className="mt-1 text-right text-xs text-gold-600 dark:text-gold-300">
              {assetSize ? formatKRW(assetSize) : "—"}
            </p>
          </div>

          <div className="col-span-2 rounded-xl border border-border bg-surface-2 p-3">
            <label className="label">이메일</label>
            <input
              className="input"
              type="email"
              value={email}
              placeholder="예: client@example.com"
              onChange={(e) => {
                setEmail(e.target.value);
                setEmailError("");
              }}
            />
            {emailError && <p className="mt-1 text-[11px] text-red-500">{emailError}</p>}
            <label className="mt-3 flex items-center gap-2 text-xs text-fg-muted">
              <input
                type="checkbox"
                className="accent-gold-500"
                checked={emailOptIn}
                disabled={!email.trim()}
                onChange={(e) => setEmailOptIn(e.target.checked)}
              />
              모닝 브리핑 수신 동의
            </label>
            <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
              동의한 고객에게만 발송됩니다.
            </p>
          </div>

          {isSole && (
            <div className="col-span-2">
              <label className="label">개인사업자 통장 분리 여부</label>
              <div className="grid grid-cols-3 gap-2">
                {(["separated", "mixed", "unknown"] as AccountSeparation[]).map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold transition-colors ${
                      accountSeparation === value
                        ? "border-gold-400 bg-gold-50 text-gold-800 dark:bg-gold-900/20 dark:text-gold-200"
                        : "border-border bg-surface-2 text-fg-muted hover:text-fg"
                    }`}
                    onClick={() => setAccountSeparation(value)}
                  >
                    {ACCOUNT_SEPARATION_LABEL[value]}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                혼용 또는 미확인 상태면 포트폴리오 산출에서 투자 가능 현금을 보수적으로 해석합니다.
              </p>
            </div>
          )}

          {!isSole && (
            <div className="col-span-2 rounded-xl border border-border bg-surface-2 p-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_120px]">
                <div>
                  <label className="label">
                    {isCorp ? "대표/주주 개인 고객 연결" : "연동 법인 고객"}
                  </label>
                  <select
                    className="input"
                    value={linkedClientId}
                    onChange={(e) => setLinkedClientId(e.target.value)}
                  >
                    <option value="">연동 안 함</option>
                    {linkedCandidates.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name} · {CLIENT_TYPE_LABEL[candidate.clientType]}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] leading-relaxed text-fg-muted">
                    법인 배당/법인세가 대표 개인 현금흐름에 영향을 줄 수 있는 경우 연결합니다.
                  </p>
                </div>
                <div>
                  <label className="label">지분율(%)</label>
                  <input
                    className="input text-right"
                    inputMode="decimal"
                    value={ownershipText}
                    placeholder="예: 60"
                    onChange={(e) => setOwnershipText(e.target.value.replace(/[^0-9.]/g, ""))}
                    disabled={!linkedClientId}
                  />
                </div>
              </div>
              <label className="mt-3 flex items-center gap-2 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  className="accent-gold-500"
                  checked={isMajorityShareholder}
                  onChange={(e) => setIsMajorityShareholder(e.target.checked)}
                  disabled={!linkedClientId}
                />
                최대주주/실질 지배주주로 상담에 반영
              </label>
            </div>
          )}
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
