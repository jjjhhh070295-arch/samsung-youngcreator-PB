"use client";

/**
 * 예·적금 섹션 — 단순화 입력(유형·잔액·이율·개시·만기연수).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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

interface Props {
  clientId: string;
  onChanged?: () => void;
  /** 예·적금 예상 이자 집계 → 금융소득 프로파일(읽기전용) 반영 */
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

  const year = new Date().getFullYear();
  const asOf = new Date().toISOString().slice(0, 10);

  const emitDerived = useCallback(
    (rows: DepositProduct[]) => {
      const agg = aggregateDerivedDepositInterest(rows, {
        asOf,
        projectionYear: year,
      });
      onDerivedInterestChange?.(agg.incomplete && agg.totalGrossWon == null ? null : agg.totalGrossWon ?? 0);
    },
    [asOf, onDerivedInterestChange, year],
  );

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const rows = (await listDepositProducts(clientId)).map(normalizeLoaded);
      setProducts(rows);
      emitDerived(rows);
      setStatus("ready");
    } catch (e: any) {
      setError(e?.message || "불러오기 실패");
      setStatus("ready");
    }
  }, [clientId, emitDerived]);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = async (next: DepositProduct[]) => {
    setStatus("saving");
    setError(null);
    const synced = next.map(withSyncedMaturity);
    try {
      await saveDepositProducts(clientId, synced);
      setProducts(synced);
      emitDerived(synced);
      publishClientLiveSync(clientId, "assets", "deposits");
      onChanged?.();
    } catch (e: any) {
      setError(e?.message || "저장 실패");
    } finally {
      setStatus("ready");
    }
  };

  const patchAt = (idx: number, patch: Partial<DepositProduct>, save = false) => {
    const next = [...products];
    next[idx] = withSyncedMaturity({ ...next[idx], ...patch, asOf });
    setProducts(next);
    emitDerived(next);
    if (save) void persist(next);
  };

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
          onClick={() => void persist([...products, emptyProduct()])}
        >
          + 상품 추가
        </button>
      </div>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

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
                      onChange={(e) => {
                        patchAt(
                          idx,
                          {
                            productType: e.target.value === "installment" ? "installment" : "deposit",
                          },
                          true,
                        );
                      }}
                    >
                      <option value="deposit">예금</option>
                      <option value="installment">적금</option>
                    </select>
                  </label>
                  <label className="text-[11px]">
                    잔액(원)
                    <input
                      type="number"
                      className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
                      value={p.principalWon ?? ""}
                      placeholder="미입력"
                      onChange={(e) =>
                        patchAt(idx, {
                          principalWon: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      onBlur={() => {
                        setProducts((current) => {
                          void persist(current.map(withSyncedMaturity));
                          return current;
                        });
                      }}
                    />
                  </label>
                  <label className="text-[11px]">
                    약정 연이율(%)
                    <input
                      type="number"
                      step="0.01"
                      className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
                      value={p.annualRatePct ?? ""}
                      placeholder="미입력"
                      onChange={(e) =>
                        patchAt(idx, {
                          annualRatePct: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                      onBlur={() => {
                        setProducts((current) => {
                          void persist(current.map(withSyncedMaturity));
                          return current;
                        });
                      }}
                    />
                  </label>
                  {p.productType === "installment" && (
                    <label className="text-[11px]">
                      회차 납입액(원)
                      <input
                        type="number"
                        className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
                        value={p.contributionAmountWon ?? ""}
                        placeholder="미입력"
                        onChange={(e) =>
                          patchAt(idx, {
                            contributionAmountWon:
                              e.target.value === "" ? null : Number(e.target.value),
                          })
                        }
                        onBlur={() => {
                        setProducts((current) => {
                          void persist(current.map(withSyncedMaturity));
                          return current;
                        });
                      }}
                      />
                    </label>
                  )}
                  <label className="text-[11px]">
                    개시일
                    <input
                      type="date"
                      className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
                      value={p.openedAt ?? ""}
                      onChange={(e) => patchAt(idx, { openedAt: e.target.value || null })}
                      onBlur={() => {
                        setProducts((current) => {
                          void persist(current.map(withSyncedMaturity));
                          return current;
                        });
                      }}
                    />
                  </label>
                  <label className="text-[11px]">
                    만기
                    <select
                      className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
                      value={p.termYears ?? ""}
                      onChange={(e) => {
                        const years = e.target.value === "" ? null : Number(e.target.value);
                        patchAt(
                          idx,
                          {
                            termYears: years,
                            maturesAt:
                              years != null && p.openedAt
                                ? addCalendarYears(p.openedAt, years)
                                : p.maturesAt,
                          },
                          true,
                        );
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
                  <span className="font-semibold text-fg">
                    {resolved.maturesAt ?? "—"}
                  </span>
                  {p.termYears != null ? " (연수 기준 자동 계산)" : ""}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-fg-muted">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={p.identifiedInCashBalance}
                      onChange={(e) =>
                        patchAt(idx, { identifiedInCashBalance: e.target.checked }, true)
                      }
                    />
                    현금/자산에 이미 포함(이중계상 금지)
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={p.includeInManagedPreview}
                      onChange={(e) =>
                        patchAt(idx, { includeInManagedPreview: e.target.checked }, true)
                      }
                    />
                    Portfolio preview 포함
                  </label>
                  <button
                    type="button"
                    className="text-red-600"
                    onClick={() => void persist(products.filter((x) => x.id !== p.id))}
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
