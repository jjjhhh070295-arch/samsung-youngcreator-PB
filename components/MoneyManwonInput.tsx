"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  formatManwonBlur,
  isManwonDraftAllowed,
  parseManwonInput,
  wonToManwonDraft,
} from "@/lib/moneyManwon";

/**
 * 만원 단위 편집 입력. 타이핑 중에는 문자열 초안을 유지하고, blur/Enter 시에만 원으로 커밋한다.
 * 저장/API/계산은 항상 원(won). UI만 만원.
 *
 * Covered field categories (customer PB workflow KRW amounts):
 * - Deposit principal / installment contribution
 * - Financial-income tax wage · assessed tax · interest · dividend
 * - Simple cashflow period inflow / outflow / tax
 * - Real-estate market value · acquisition · deposit · rent · debt balance
 * - Client form asset size
 * - Manual portfolio allocation amounts (amount mode)
 * - Stock-sector plan amounts
 * - Korean stock trend filter buy-seed amounts
 * - Transfer-event valuation amounts
 * - Detailed CashFlowEditor row amounts (signed)
 *
 * Not covered: rates · % · years · dates · FX · quantities · unit prices;
 * stress models that store 억원 as a native domain unit (not won display adapters).
 */
type Props = {
  label: string;
  /** 저장된 원 단위 값. null = 미입력 */
  valueWon: number | null;
  onCommitWon: (won: number | null) => void;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  disabled?: boolean;
  allowSigned?: boolean;
  /** 라벨 옆에 붙는 도움말 */
  hint?: string;
  /** 테이블 헤더 등에 라벨이 있을 때 시각 라벨 숨김(aria는 유지) */
  hideLabel?: boolean;
};

export default function MoneyManwonInput({
  label,
  valueWon,
  onCommitWon,
  className,
  inputClassName,
  placeholder = "미입력",
  disabled,
  allowSigned,
  hint,
  hideLabel,
}: Props) {
  const id = useId();
  const focusedRef = useRef(false);
  const [draft, setDraft] = useState(() => wonToManwonDraft(valueWon));
  const [error, setError] = useState<string | null>(null);

  const lastCommittedRef = useRef<number | null | undefined>(valueWon);
  const committingRef = useRef(false);

  useEffect(() => {
    if (focusedRef.current) return;
    setDraft(wonToManwonDraft(valueWon));
    lastCommittedRef.current = valueWon;
  }, [valueWon]);

  const sameWon = (a: number | null | undefined, b: number | null | undefined) => {
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    return a === b;
  };

  const commit = () => {
    if (committingRef.current) return;
    const parsed = parseManwonInput(draft, { allowSigned });
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setError(null);
    const next = "empty" in parsed && parsed.empty ? null : parsed.won;
    setDraft(formatManwonBlur(next));
    if (sameWon(next, lastCommittedRef.current) && sameWon(next, valueWon)) {
      return;
    }
    lastCommittedRef.current = next;
    committingRef.current = true;
    try {
      onCommitWon(next);
    } finally {
      // Enter→blur 이중 커밋 방지; 다음 틱에 해제
      queueMicrotask(() => {
        committingRef.current = false;
      });
    }
  };

  return (
    <label className={className ?? "text-[11px]"} htmlFor={id}>
      {!hideLabel && (
        <span className="font-bold text-fg">
          {label} <span className="font-semibold text-fg-muted">(만원)</span>
        </span>
      )}
      {hideLabel && <span className="sr-only">{label} (만원)</span>}
      {hint && !hideLabel && (
        <span className="mt-0.5 block text-[10px] font-normal text-fg-muted">{hint}</span>
      )}
      <span className={`flex items-center gap-1 ${hideLabel ? "" : "mt-0.5"}`}>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          disabled={disabled}
          className={
            inputClassName ??
            "w-full rounded border border-border px-2 py-1 text-sm tabular-nums"
          }
          value={draft}
          placeholder={placeholder}
          aria-invalid={!!error}
          onFocus={() => {
            focusedRef.current = true;
          }}
          onChange={(e) => {
            const next = e.target.value;
            if (!isManwonDraftAllowed(next, allowSigned)) return;
            setDraft(next);
            setError(null);
          }}
          onBlur={() => {
            focusedRef.current = false;
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <span className="shrink-0 text-[11px] font-semibold text-fg-muted">만원</span>
      </span>
      {error && <span className="mt-0.5 block text-[10px] text-rose-600">{error}</span>}
    </label>
  );
}
