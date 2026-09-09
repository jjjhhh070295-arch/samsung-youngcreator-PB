"use client";

/**
 * 예·적금 — 안정 입력(초안 문자열)·만원·제품별 저장.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatKRW } from "@/lib/format";
import { formatPercent1 } from "@/lib/formatPercent";
import type { DepositProduct } from "@/lib/tax/depositInterest";
import {
  aggregateDerivedDepositInterest,
  calculateDepositInterest,
  sumDepositBalances,
} from "@/lib/tax/depositInterest";
import {
  addCalendarYears,
  displayDepositLabel,
  resolveMaturesAt,
} from "@/lib/tax/depositMaturity";
import {
  listDepositProducts,
  newDepositProductId,
  saveDepositProducts,
} from "@/lib/deposits/store";
import { publishClientLiveSync } from "@/lib/clientLiveSync";
import MoneyManwonInput from "@/components/MoneyManwonInput";

interface Props {
  clientId: string;
  onChanged?: () => void;
  /** 예·적금 예상 이자 — 값이 바뀐 때만 호출 */
  onDerivedInterestChange?: (grossWon: number | null) => void;
}

const TERM_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);

const emptyProduct = (): DepositProduct => {
  const today = new Date().toISOString().slice(0, 10);
  return {
    id: newDepositProductId(),
    institution: "",
    productName: "",
    productType: "deposit",
    currency: "KRW",
    principalWon: null,
    annualRatePct: null,
    openedAt: today,
    termYears: 1,
    maturesAt: addCalendarYears(today, 1),
    interestSchedule: "만기일시",
    convention: "simple",
    taxStatus: "taxable",
    contributionAmountWon: null,
    contributionFrequency: "monthly",
    contributionDates: null,
    includeInManagedPreview: true,
    identifiedInCashBalance: false,
    source: "manual",
    asOf: today,
  };
};

function normalizeLoaded(p: DepositProduct): DepositProduct {
  const resolved = resolveMaturesAt({
    openedAt: p.openedAt,
    termYears: p.termYears ?? null,
    maturesAt: p.maturesAt,
  });
  return {
    ...p,
    termYears: resolved.termYears ?? p.termYears ?? null,
    maturesAt: resolved.maturesAt ?? p.maturesAt,
    currency: p.currency || "KRW",
    taxStatus: p.taxStatus || "taxable",
    convention: p.convention || "simple",
  };
}

function withSyncedMaturity(p: DepositProduct): DepositProduct {
  if (p.termYears != null && p.openedAt) {
    return { ...p, maturesAt: addCalendarYears(p.openedAt, p.termYears) };
  }
  return p;
}

export default function DepositProductsSection({
  clientId,
  onChanged,
  onDerivedInterestChange,
}: Props) {
  const [products, setProducts] = useState<DepositProduct[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "saving">("loading");
  const [error, setError] = useState<string | null>(null);
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>({});

  const productsRef = useRef(products);
  productsRef.current = products;
  const dirtyRef = useRef(false);
  const revisionRef = useRef(0);
  const derivedCbRef = useRef(onDerivedInterestChange);
  derivedCbRef.current = onDerivedInterestChange;
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const lastEmittedDerivedRef = useRef<number | null | undefined>(undefined);

  const year = new Date().getFullYear();
  const asOf = new Date().toISOString().slice(0, 10);

  const emitDerivedIfChanged = useCallback((rows: DepositProduct[]) => {
    const agg = aggregateDerivedDepositInterest(rows, { asOf, projectionYear: year });
    const next =
      agg.incomplete && agg.totalGrossWon == null ? null : (agg.totalGrossWon ?? 0);
    if (lastEmittedDerivedRef.current === next) return;
    lastEmittedDerivedRef.current = next;
    derivedCbRef.current?.(next);
  }, [asOf, year]);

  // 고객 변경 시에만 로드 — 콜백 정체성으로 재로드하지 않음
  useEffect(() => {
    let cancelled = false;
    dirtyRef.current = false;
    revisionRef.current += 1;
    const loadRev = revisionRef.current;
    setStatus("loading");
    setError(null);
    void listDepositProducts(clientId)
      .then((rows) => {
        if (cancelled || loadRev !== revisionRef.current) return;
        if (dirtyRef.current) return; // 로드 중 편집 보호
        const normalized = rows.map(normalizeLoaded);
        setProducts(normalized);
        setRateDrafts({});
        emitDerivedIfChanged(normalized);
        setStatus("ready");
      })
      .catch((e: any) => {
        if (cancelled || loadRev !== revisionRef.current) return;
        setError(e?.message || "불러오기 실패");
        setStatus("ready");
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, emitDerivedIfChanged]);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushPersist = useCallback(async () => {
    const writeRev = revisionRef.current;
    const latest = productsRef.current.map(withSyncedMaturity);
    setStatus("saving");
    setError(null);
    try {
      const result = await saveDepositProducts(clientId, latest);
      if (writeRev !== revisionRef.current) return;
      if (!result.ok) {
        setError(result.error || "저장 실패");
      } else if (result.error) {
        setError(result.error);
      } else {
        setError(null);
      }
      if (writeRev === revisionRef.current) {
        dirtyRef.current = false;
        publishClientLiveSync(clientId, "assets", "deposits");
        onChangedRef.current?.();
      }
    } catch (e: any) {
      if (writeRev === revisionRef.current) {
        setError(e?.message || "저장 실패");
      }
    } finally {
      if (writeRev === revisionRef.current) setStatus("ready");
    }
  }, [clientId]);

  const enqueuePersist = useCallback(
    (next: DepositProduct[]) => {
      dirtyRef.current = true;
      revisionRef.current += 1;
      const synced = next.map(withSyncedMaturity);
      setProducts(synced);
      productsRef.current = synced;
      emitDerivedIfChanged(synced);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void flushPersist();
      }, 280);
    },
    [emitDerivedIfChanged, flushPersist],
  );

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const patchProduct = useCallback(
    (productId: string, patch: Partial<DepositProduct>, persist = true) => {
      dirtyRef.current = true;
      const next = productsRef.current.map((p) =>
        p.id === productId ? withSyncedMaturity({ ...p, ...patch, asOf }) : p,
      );
      setProducts(next);
      productsRef.current = next;
      emitDerivedIfChanged(next);
      if (persist) enqueuePersist(next);
    },
    [asOf, emitDerivedIfChanged, enqueuePersist],
  );

  const totals = sumDepositBalances(products);
  const typeOrdinal = useMemo(() => {
    const counts = { deposit: 0, installment: 0 };
    return products.map((p) => {
      counts[p.productType] += 1;
      return counts[p.productType];
    });
  }, [products]);

  return (
    <section className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-fg">예·적금</h3>
          <p className="text-[11px] text-fg-muted">
            잔액 합계{" "}
            {totals.incomplete ? "일부 미입력" : formatKRW(totals.totalPrincipalWon ?? 0)}
            {status === "saving" ? " · 저장 중…" : ""}
          </p>
        </div>
        <button
          type="button"
          className="btn-outline text-xs"
          onClick={() => {
            const next = [...productsRef.current, emptyProduct()];
            enqueuePersist(next);
          }}
        >
          + 상품 추가
        </button>
      </div>

      {error && (
        <p className="mt-2 text-xs text-red-600">
          {error}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => enqueuePersist(productsRef.current)}
          >
            다시 저장
          </button>
        </p>
      )}

      {products.length === 0 ? (
        <p className="mt-3 text-xs text-fg-muted">등록된 예·적금이 없습니다.</p>
      ) : (
        <div className="mt-3 space-y-3">
          {products.map((p, idx) => {
            const interest = calculateDepositInterest(
              { ...p, asOf },
              { asOf, projectionYear: year },
            );
            const resolved = resolveMaturesAt(p);
            const label = displayDepositLabel(p.productType, typeOrdinal[idx]);
            const nonOrdinary = p.taxStatus && p.taxStatus !== "taxable";
            return (
              <div key={p.id} className="rounded-lg border border-[#E2E8F0] p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <p className="text-xs font-bold text-fg">{label}</p>
                  {nonOrdinary && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                      {p.taxStatus === "exempt"
                        ? "비과세(기존)"
                        : p.taxStatus === "preferential"
                          ? "우대·분리(기존)"
                          : "과세 미확인(기존)"}
                    </span>
                  )}
                  {resolved.legacyMaturityNeedsReview && (
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800">
                      기존 만기일 확인 필요
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <label className="text-[11px]">
                    유형
                    <select
                      className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
                      value={p.productType}
                      onChange={(e) =>
                        patchProduct(p.id, {
                          productType:
                            e.target.value === "installment" ? "installment" : "deposit",
                        })
                      }
                    >
                      <option value="deposit">예금</option>
                      <option value="installment">적금</option>
                    </select>
                  </label>
                  <MoneyManwonInput
                    label="잔액"
                    valueWon={p.principalWon}
                    onCommitWon={(won) => patchProduct(p.id, { principalWon: won })}
                  />
                  <label className="text-[11px]">
                    약정 연이율(%)
                    <input
                      type="text"
                      inputMode="decimal"
                      className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
                      value={
                        rateDrafts[p.id] ??
                        (p.annualRatePct == null ? "" : String(p.annualRatePct))
                      }
                      placeholder="미입력"
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v !== "" && !/^\d*\.?\d*$/.test(v)) return;
                        dirtyRef.current = true;
                        setRateDrafts((d) => ({ ...d, [p.id]: v }));
                      }}
                      onBlur={() => {
                        const raw = rateDrafts[p.id];
                        const draft =
                          raw !== undefined
                            ? raw
                            : p.annualRatePct == null
                              ? ""
                              : String(p.annualRatePct);
                        const parsed =
                          draft.trim() === ""
                            ? null
                            : Number.isFinite(Number(draft))
                              ? Number(draft)
                              : null;
                        setRateDrafts((d) => {
                          const next = { ...d };
                          delete next[p.id];
                          return next;
                        });
                        patchProduct(p.id, { annualRatePct: parsed });
                      }}
                    />
                  </label>
                  {p.productType === "installment" && (
                    <MoneyManwonInput
                      label="회차 납입액"
                      valueWon={p.contributionAmountWon ?? null}
                      onCommitWon={(won) =>
                        patchProduct(p.id, { contributionAmountWon: won })
                      }
                    />
                  )}
                  <label className="text-[11px]">
                    개시일
                    <input
                      type="date"
                      className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
                      value={p.openedAt ?? ""}
                      onChange={(e) =>
                        patchProduct(p.id, { openedAt: e.target.value || null })
                      }
                    />
                  </label>
                  <label className="text-[11px]">
                    만기
                    <select
                      className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
                      value={p.termYears ?? ""}
                      onChange={(e) => {
                        const years = e.target.value === "" ? null : Number(e.target.value);
                        patchProduct(p.id, {
                          termYears: years,
                          maturesAt:
                            years != null && p.openedAt
                              ? addCalendarYears(p.openedAt, years)
                              : p.maturesAt,
                        });
                      }}
                    >
                      <option value="">선택</option>
                      {TERM_OPTIONS.map((y) => (
                        <option key={y} value={y}>
                          {y}년
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="mt-1 text-[10px] text-fg-muted">
                  만기일{" "}
                  <span className="font-semibold text-fg">{resolved.maturesAt ?? "—"}</span>
                  {p.termYears != null ? " (연수 기준 자동 계산)" : ""}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-fg-muted">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={p.identifiedInCashBalance}
                      onChange={(e) =>
                        patchProduct(p.id, { identifiedInCashBalance: e.target.checked })
                      }
                    />
                    현금/자산에 이미 포함(이중계상 금지)
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={p.includeInManagedPreview}
                      onChange={(e) =>
                        patchProduct(p.id, { includeInManagedPreview: e.target.checked })
                      }
                    />
                    Portfolio preview 포함
                  </label>
                  <button
                    type="button"
                    className="text-red-600"
                    onClick={() => {
                      const next = productsRef.current.filter((x) => x.id !== p.id);
                      enqueuePersist(next);
                    }}
                  >
                    삭제
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-[#1428A0]">
                  {year}년 예상 이자{" "}
                  {interest.grossInterestWon == null
                    ? interest.status === "matured"
                      ? "만기 도래 · 0"
                      : "산출 전"
                    : formatKRW(interest.grossInterestWon)}
                  {interest.withholdingTotalWon != null
                    ? ` · 원천징수 참고 ${formatKRW(interest.withholdingTotalWon)}`
                    : ""}
                  {p.annualRatePct != null ? ` · ${formatPercent1(p.annualRatePct)}` : ""}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
