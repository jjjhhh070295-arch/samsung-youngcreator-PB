"use client";

/**
 * 예·적금 섹션 — 부동산 자산 바로 아래 배치용.
 */

import { useCallback, useEffect, useState } from "react";
import { formatKRW } from "@/lib/format";
import { formatPercent1 } from "@/lib/formatPercent";
import type { DepositProduct } from "@/lib/tax/depositInterest";
import {
  calculateDepositInterest,
  sumDepositBalances,
} from "@/lib/tax/depositInterest";
import {
  listDepositProducts,
  newDepositProductId,
  saveDepositProducts,
} from "@/lib/deposits/store";
import { publishClientLiveSync } from "@/lib/clientLiveSync";

interface Props {
  clientId: string;
  onChanged?: () => void;
}

const emptyProduct = (): DepositProduct => ({
  id: newDepositProductId(),
  institution: "",
  productName: "",
  productType: "deposit",
  currency: "KRW",
  principalWon: null,
  annualRatePct: null,
  openedAt: null,
  maturesAt: null,
  interestSchedule: "만기일시",
  convention: "simple",
  taxStatus: "taxable",
  contributionAmountWon: null,
  contributionFrequency: "monthly",
  contributionDates: null,
  includeInManagedPreview: true,
  identifiedInCashBalance: false,
  source: "manual",
  asOf: new Date().toISOString().slice(0, 10),
});

export default function DepositProductsSection({ clientId, onChanged }: Props) {
  const [products, setProducts] = useState<DepositProduct[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "saving">("loading");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const rows = await listDepositProducts(clientId);
      setProducts(rows);
      setStatus("ready");
    } catch (e: any) {
      setError(e?.message || "불러오기 실패");
      setStatus("ready");
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const persist = async (next: DepositProduct[]) => {
    setStatus("saving");
    setError(null);
    try {
      await saveDepositProducts(clientId, next);
      setProducts(next);
      publishClientLiveSync(clientId, "assets", "deposits");
      onChanged?.();
    } catch (e: any) {
      setError(e?.message || "저장 실패");
    } finally {
      setStatus("ready");
    }
  };

  const totals = sumDepositBalances(products);
  const year = new Date().getFullYear();

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
            const interest = calculateDepositInterest(p, { projectionYear: year });
            return (
              <div key={p.id} className="rounded-lg border border-[#E2E8F0] p-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <label className="text-[11px]">
                    금융기관
                    <input
                      className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
                      value={p.institution}
                      onChange={(e) => {
                        const next = [...products];
                        next[idx] = { ...p, institution: e.target.value };
                        setProducts(next);
                      }}
                      onBlur={() => void persist(products)}
                    />
                  </label>
                  <label className="text-[11px]">
                    상품명
                    <input
                      className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
                      value={p.productName}
                      onChange={(e) => {
                        const next = [...products];
                        next[idx] = { ...p, productName: e.target.value };
                        setProducts(next);
                      }}
                      onBlur={() => void persist(products)}
                    />
                  </label>
                  <label className="text-[11px]">
                    유형
                    <select
                      className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
                      value={p.productType}
                      onChange={(e) => {
                        const next = [...products];
                        next[idx] = {
                          ...p,
                          productType: e.target.value === "installment" ? "installment" : "deposit",
                        };
                        setProducts(next);
                        void persist(next);
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
                      onChange={(e) => {
                        const next = [...products];
                        next[idx] = {
                          ...p,
                          principalWon: e.target.value === "" ? null : Number(e.target.value),
                        };
                        setProducts(next);
                      }}
                      onBlur={() => void persist(products)}
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
                      onChange={(e) => {
                        const next = [...products];
                        next[idx] = {
                          ...p,
                          annualRatePct: e.target.value === "" ? null : Number(e.target.value),
                        };
                        setProducts(next);
                      }}
                      onBlur={() => void persist(products)}
                    />
                  </label>
                  <label className="text-[11px]">
                    과세
                    <select
                      className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
                      value={p.taxStatus}
                      onChange={(e) => {
                        const next = [...products];
                        next[idx] = { ...p, taxStatus: e.target.value as DepositProduct["taxStatus"] };
                        setProducts(next);
                        void persist(next);
                      }}
                    >
                      <option value="taxable">과세</option>
                      <option value="exempt">비과세</option>
                      <option value="preferential">우대·분리</option>
                      <option value="unknown">미확인</option>
                    </select>
                  </label>
                  <label className="text-[11px]">
                    개시일
                    <input
                      type="date"
                      className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
                      value={p.openedAt ?? ""}
                      onChange={(e) => {
                        const next = [...products];
                        next[idx] = { ...p, openedAt: e.target.value || null };
                        setProducts(next);
                      }}
                      onBlur={() => void persist(products)}
                    />
                  </label>
                  <label className="text-[11px]">
                    만기일
                    <input
                      type="date"
                      className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
                      value={p.maturesAt ?? ""}
                      onChange={(e) => {
                        const next = [...products];
                        next[idx] = { ...p, maturesAt: e.target.value || null };
                        setProducts(next);
                      }}
                      onBlur={() => void persist(products)}
                    />
                  </label>
                  {p.productType === "installment" && (
                    <label className="text-[11px]">
                      회차 납입액
                      <input
                        type="number"
                        className="mt-0.5 w-full rounded border border-border px-2 py-1 text-sm"
                        value={p.contributionAmountWon ?? ""}
                        onChange={(e) => {
                          const next = [...products];
                          next[idx] = {
                            ...p,
                            contributionAmountWon:
                              e.target.value === "" ? null : Number(e.target.value),
                          };
                          setProducts(next);
                        }}
                        onBlur={() => void persist(products)}
                      />
                    </label>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-[11px] text-fg-muted">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={p.identifiedInCashBalance}
                      onChange={(e) => {
                        const next = [...products];
                        next[idx] = { ...p, identifiedInCashBalance: e.target.checked };
                        setProducts(next);
                        void persist(next);
                      }}
                    />
                    현금/자산에 이미 포함(이중계상 금지)
                  </label>
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={p.includeInManagedPreview}
                      onChange={(e) => {
                        const next = [...products];
                        next[idx] = { ...p, includeInManagedPreview: e.target.checked };
                        setProducts(next);
                        void persist(next);
                      }}
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
                    ? "산출 전"
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
